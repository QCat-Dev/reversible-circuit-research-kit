//! Quantum Cat platform evaluator, release qcat-ecc-random-v2.
//! This is a new platform policy, not an upstream challenge-equivalence claim.
//! Reads only circuit data and one frozen 32-byte sampling seed; no author code.

use alloy_primitives::U256;
use quantum_ecc::circuit::{analyze_ops, BitId, Op, OperationType, QubitId, QubitOrBit, RegisterId};
use quantum_ecc::sim::{Simulator, SimStats};
use quantum_ecc::weierstrass_elliptic_curve::WeierstrassEllipticCurve;
use sha3::{digest::{ExtendableOutput, Update, XofReader}, Digest, Sha3_256, Shake256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::Path;

const RELEASE_ID: &str = "qcat-ecc-random-v2";
const OPS_PATH: &str = "ops.bin";
const SEED_PATH: &str = "sampling-seed.bin";
const RESULT_PATH: &str = "result.json";
const INPUT_DOMAIN: &[u8] = b"qcat-ecc-random-10048-v1/inputs";
const MEASUREMENT_DOMAIN: &[u8] = b"qcat-ecc-random-10048-v1/measurement";
const MAGIC: &[u8; 8] = b"QECCOPSZ";
const OP_BYTES: usize = 56;
const NUM_INPUTS: usize = 10_048;
const BATCH_SIZE: usize = 64;
const NUM_BATCHES: usize = NUM_INPUTS / BATCH_SIZE;
const _: () = assert!(NUM_INPUTS % BATCH_SIZE == 0);
const _: () = assert!(NUM_INPUTS >= 10_000 && NUM_INPUTS - BATCH_SIZE < 10_000);
const MAX_INCORRECT_INPUTS: usize = 1;
const MAX_RESULT_BYTES: usize = 128 * 1024;
const ZSTD_WINDOW_LOG_MAX: u32 = 27;
const MAX_COMPRESSED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_OPS: u64 = 40_000_000;
const MAX_EXPANDED_BYTES: u64 = MAX_OPS * OP_BYTES as u64;
const MAX_QUBITS: u64 = 65_536;
const MAX_BITS: u64 = 4_194_304;
const MAX_REGISTERS: u64 = 4;
const MAX_REGISTER_WIDTH: usize = 256;
const MAX_CONDITION_DEPTH: usize = 4096;
const MAX_MEMORY_ESTIMATE_BYTES: u64 = 3072 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct Failure { status: &'static str, code: &'static str }
impl Failure {
    fn rejected(code: &'static str) -> Self { Self { status: "rejected", code } }
    fn internal(code: &'static str) -> Self { Self { status: "error", code } }
}

#[derive(Debug)]
struct ServerResult {
    status: &'static str,
    stage: &'static str,
    eligible_inputs: Option<usize>,
    executed_inputs: usize,
    executed_batches: usize,
    incorrect: Option<usize>,
    classical: Option<usize>,
    phase: Option<usize>,
    workspace: Option<usize>,
    phase_batches: Option<usize>,
    workspace_batches: Option<usize>,
    failure_inputs: Vec<(usize, u8)>,
    seed: Option<[u8; 32]>,
    input_digest: Option<[u8; 32]>,
    op_count: Option<u64>,
    qubits: Option<u64>,
    total_toffoli: Option<u64>,
    total_clifford: Option<u64>,
    rounded_mean_toffoli: Option<u64>,
    score: Option<u64>,
    failure_code: Option<&'static str>,
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for &b in bytes { text.push(DIGITS[(b >> 4) as usize] as char); text.push(DIGITS[(b & 15) as usize] as char); }
    text
}

impl ServerResult {
    fn new() -> Self {
        Self { status: "error", stage: "load", eligible_inputs: None,
            executed_inputs: 0, executed_batches: 0, incorrect: None, classical: None,
            phase: None, workspace: None, phase_batches: None, workspace_batches: None,
            failure_inputs: Vec::new(), seed: None, input_digest: None, op_count: None,
            qubits: None, total_toffoli: None, total_clifford: None,
            rounded_mean_toffoli: None, score: None, failure_code: None }
    }
    fn coverage_complete(&self) -> bool {
        self.eligible_inputs == Some(NUM_INPUTS) && self.executed_inputs == NUM_INPUTS
            && self.executed_batches == NUM_BATCHES
    }
    fn update_score(&mut self) {
        // Partial execution retains real totals, but never presents a full-run score.
        if !self.coverage_complete() { return; }
        if let (Some(total), Some(q)) = (self.total_toffoli, self.qubits) {
            let rounded = (total as f64 / NUM_INPUTS as f64).round() as u64;
            self.rounded_mean_toffoli = Some(rounded);
            self.score = Some(rounded.saturating_mul(q));
        }
    }
    fn fail(&mut self, failure: Failure) {
        self.status = failure.status;
        self.failure_code = Some(failure.code);
    }
    fn to_json(&self) -> String {
        fn count(value: Option<usize>) -> String { value.map(|n| n.to_string()).unwrap_or("null".into()) }
        fn decimal(value: Option<u64>) -> String { value.map(|n| format!("\"{n}\"")).unwrap_or("null".into()) }
        let failure = self.failure_code.map(|code| format!("{{\"code\":\"{code}\",\"details\":null}}")).unwrap_or("null".into());
        let sampling = self.seed.map(|seed| {
            let digest = self.input_digest.map(|d| format!("\"{}\"", hex(&d))).unwrap_or("null".into());
            format!("{{\"seed\":\"{}\",\"inputDigest\":{digest},\"inputDigestAlgorithm\":\"sha3-256\"}}", hex(&seed))
        }).unwrap_or("null".into());
        let details = self.failure_inputs.iter().map(|(index, mask)| format!("[{index},{mask}]")).collect::<Vec<_>>().join(",");
        // Strings are fixed constants or lowercase hex; failure details contain integers only.
        format!(concat!(
            "{{\n  \"schemaVersion\":\"qcat-server-result-v2\",\n",
            "  \"taskVersion\":\"ecc-random-v2\",\n  \"policy\":\"qcat-ecc-random-10048-v1\",\n",
            "  \"status\":\"{}\",\n  \"stage\":\"{}\",\n",
            "  \"coverage\":{{\"requestedInputs\":10048,\"eligibleInputs\":{},\"executedInputs\":{},\"executedBatches\":{},\"complete\":{}}},\n",
            "  \"errors\":{{\"incorrectInputs\":{},\"classicalMismatchInputs\":{},\"phaseErrorInputs\":{},\"workspaceErrorInputs\":{},\"phaseErrorBatches\":{},\"workspaceErrorBatches\":{}}},\n",
            "  \"resources\":{{\"opCount\":{},\"qubits\":{},\"totalExecutedToffoli\":{},\"totalExecutedClifford\":{},\"roundedMeanExecutedToffoli\":{},\"tGates\":null,\"score\":{}}},\n",
            "  \"sampling\":{},\n  \"failure\":{},\n",
            "  \"failureDetails\":{{\"encoding\":\"index-error-mask-v1\",\"inputs\":[{}]}}\n}}\n"),
            self.status, self.stage, count(self.eligible_inputs), self.executed_inputs,
            self.executed_batches, self.coverage_complete(), count(self.incorrect), count(self.classical),
            count(self.phase), count(self.workspace), count(self.phase_batches), count(self.workspace_batches),
            decimal(self.op_count), decimal(self.qubits), decimal(self.total_toffoli), decimal(self.total_clifford),
            decimal(self.rounded_mean_toffoli), decimal(self.score), sampling, failure, details)
    }
}

fn load_seed(path: &Path) -> Result<[u8; 32], Failure> {
    let before = fs::symlink_metadata(path).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        Failure::rejected("sampling_seed_missing")
    } else { Failure::internal("sampling_seed_metadata_error") })?;
    if !before.is_file() { return Err(Failure::rejected("sampling_seed_not_regular")); }
    if before.len() != 32 { return Err(Failure::rejected("sampling_seed_length")); }
    let mut file = File::open(path).map_err(|_| Failure::internal("sampling_seed_open_error"))?;
    let opened = file.metadata().map_err(|_| Failure::internal("sampling_seed_metadata_error"))?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != before.dev() || opened.ino() != before.ino() {
            return Err(Failure::rejected("sampling_seed_changed"));
        }
    }
    if !opened.is_file() || opened.len() != 32 { return Err(Failure::rejected("sampling_seed_changed")); }
    let mut seed = [0u8; 32];
    file.read_exact(&mut seed).map_err(|_| Failure::rejected("sampling_seed_length"))?;
    let mut extra = [0u8; 1];
    if file.read(&mut extra).map_err(|_| Failure::internal("sampling_seed_read_error"))? != 0 {
        return Err(Failure::rejected("sampling_seed_length"));
    }
    let after = fs::symlink_metadata(path).map_err(|_| Failure::rejected("sampling_seed_changed"))?;
    if !after.is_file() || after.len() != before.len() || after.modified().ok() != before.modified().ok() {
        return Err(Failure::rejected("sampling_seed_changed"));
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if after.ino() != before.ino() || after.dev() != before.dev() { return Err(Failure::rejected("sampling_seed_changed")); }
    }
    Ok(seed)
}

fn op_kind_from_u32(v: u32) -> Option<OperationType> {
    Some(match v {
        0 => OperationType::Neg,
        1 => OperationType::Register,
        2 => OperationType::AppendToRegister,
        3 => OperationType::BitInvert,
        4 => OperationType::BitStore0,
        5 => OperationType::BitStore1,
        6 => OperationType::X,
        7 => OperationType::Z,
        8 => OperationType::CX,
        9 => OperationType::CZ,
        10 => OperationType::Swap,
        11 => OperationType::R,
        12 => OperationType::Hmr,
        13 => OperationType::CCX,
        14 => OperationType::CCZ,
        15 => OperationType::PushCondition,
        16 => OperationType::PopCondition,
        17 => OperationType::DebugPrint,
        _ => return None,
    })
}

fn read_u64(bytes: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(bytes[off..off + 8].try_into().unwrap())
}


fn check_operation_limits(op: &Op, register_widths: &mut [usize; 4], condition_depth: &mut usize) -> Result<(), Failure> {
    for q in [op.q_control2.0, op.q_control1.0, op.q_target.0] {
        if q != u64::MAX && q >= MAX_QUBITS { return Err(Failure::rejected("qubit_index_limit")); }
    }
    for b in [op.c_target.0, op.c_condition.0] {
        if b != u64::MAX && b >= MAX_BITS { return Err(Failure::rejected("bit_index_limit")); }
    }
    if op.r_target.0 != u64::MAX && op.r_target.0 >= MAX_REGISTERS {
        return Err(Failure::rejected("register_index_limit"));
    }
    if op.kind == OperationType::AppendToRegister {
        let width = &mut register_widths[op.r_target.0 as usize];
        *width += 1;
        if *width > MAX_REGISTER_WIDTH { return Err(Failure::rejected("register_width_limit")); }
    }
    match op.kind {
        OperationType::PushCondition => {
            *condition_depth += 1;
            if *condition_depth > MAX_CONDITION_DEPTH { return Err(Failure::rejected("condition_depth_limit")); }
        }
        OperationType::PopCondition => *condition_depth = condition_depth.saturating_sub(1),
        _ => {}
    }
    Ok(())
}

fn load_ops(path: &Path) -> Result<Vec<Op>, Failure> {
    let metadata = fs::symlink_metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => Failure::rejected("input_missing"),
        _ => Failure::internal("input_metadata_error"),
    })?;
    if !metadata.is_file() { return Err(Failure::rejected("input_not_regular")); }
    if metadata.len() > MAX_COMPRESSED_BYTES { return Err(Failure::rejected("compressed_bytes_limit")); }
    if metadata.len() < 16 { return Err(Failure::rejected("truncated_header")); }
    let mut file = File::open(path).map_err(|_| Failure::internal("input_open_error"))?;
    let opened = file.metadata().map_err(|_| Failure::internal("input_metadata_error"))?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if opened.ino() != metadata.ino() || opened.dev() != metadata.dev() {
            return Err(Failure::rejected("input_changed"));
        }
    }
    if !opened.is_file() || opened.len() != metadata.len() { return Err(Failure::rejected("input_changed")); }
    let mut header = [0u8; 16];
    file.read_exact(&mut header).map_err(|_| Failure::rejected("truncated_header"))?;
    if &header[..8] != MAGIC { return Err(Failure::rejected("invalid_magic")); }
    let n = u64::from_le_bytes(header[8..].try_into().unwrap());
    if n == 0 { return Err(Failure::rejected("empty_operation_stream")); }
    if n > MAX_OPS { return Err(Failure::rejected("operation_count_limit")); }
    let expanded = n.checked_mul(OP_BYTES as u64).ok_or(Failure::rejected("expanded_bytes_limit"))?;
    if expanded > MAX_EXPANDED_BYTES { return Err(Failure::rejected("expanded_bytes_limit")); }
    let memory_estimate = n.checked_mul(std::mem::size_of::<Op>() as u64)
        .and_then(|value| value.checked_add(1u64 << ZSTD_WINDOW_LOG_MAX))
        .and_then(|value| value.checked_add((MAX_QUBITS + MAX_BITS) * 8))
        .and_then(|value| value.checked_add((NUM_INPUTS * (3 * 2 * 32 + 16)) as u64))
        .and_then(|value| value.checked_add((MAX_CONDITION_DEPTH * 8) as u64))
        .ok_or(Failure::rejected("memory_budget_limit"))?;
    if memory_estimate > MAX_MEMORY_ESTIMATE_BYTES { return Err(Failure::rejected("memory_budget_limit")); }
    let mut dec = zstd::stream::read::Decoder::new(BufReader::new(file))
        .map_err(|_| Failure::rejected("invalid_compressed_stream"))?;
    dec.window_log_max(ZSTD_WINDOW_LOG_MAX).map_err(|_| Failure::rejected("zstd_window_limit"))?;
    let mut ops = Vec::new();
    ops.try_reserve_exact(n as usize).map_err(|_| Failure::internal("operation_allocation_failed"))?;
    let mut record = [0u8; OP_BYTES];
    let mut widths = [0usize; 4];
    let mut condition_depth = 0usize;
    for _ in 0..n {
        dec.read_exact(&mut record).map_err(|_| Failure::rejected("invalid_or_truncated_records"))?;
        let raw_kind = u32::from_le_bytes(record[..4].try_into().unwrap());
        let kind = op_kind_from_u32(raw_kind).ok_or(Failure::rejected("unknown_operation_kind"))?;
        let op = Op { kind, q_control2: QubitId(read_u64(&record, 8)),
            q_control1: QubitId(read_u64(&record, 16)), q_target: QubitId(read_u64(&record, 24)),
            c_target: BitId(read_u64(&record, 32)), c_condition: BitId(read_u64(&record, 40)),
            r_target: RegisterId(read_u64(&record, 48)) };
        // Preserve every upstream Op::validate assertion; only its error envelope changes.
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op.validate())).is_err() {
            return Err(Failure::rejected("invalid_operation_fields"));
        }
        check_operation_limits(&op, &mut widths, &mut condition_depth)?;
        ops.push(op);
    }
    let mut extra = [0u8; 1];
    match dec.read(&mut extra) {
        Ok(0) => {},
        Ok(_) => return Err(Failure::rejected("trailing_decoded_data")),
        Err(_) => return Err(Failure::rejected("invalid_trailing_compressed_data")),
    }
    let after = fs::symlink_metadata(path).map_err(|_| Failure::rejected("input_changed"))?;
    if !after.is_file() || after.len() != metadata.len() || after.modified().ok() != metadata.modified().ok() {
        return Err(Failure::rejected("input_changed"));
    }
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if after.ino() != metadata.ino() || after.dev() != metadata.dev() { return Err(Failure::rejected("input_changed")); }
    }
    Ok(ops)
}


fn secp256k1() -> WeierstrassEllipticCurve {
    WeierstrassEllipticCurve {
        modulus: U256::from_str_radix(
            "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F",
            16,
        )
        .unwrap(),
        a: U256::from(0),
        b: U256::from(7),
        gx: U256::from_str_radix(
            "79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            16,
        )
        .unwrap(),
        gy: U256::from_str_radix(
            "483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8",
            16,
        )
        .unwrap(),
        order: U256::from_str_radix(
            "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
            16,
        )
        .unwrap(),
    }
}

// Independent domain streams: no operation bytes, CLI seed or environment seed.
fn domain_xof(domain: &[u8], seed: &[u8; 32]) -> sha3::Shake256Reader {
    let mut hasher = Shake256::default();
    Update::update(&mut hasher, domain);
    Update::update(&mut hasher, seed);
    hasher.finalize_xof()
}

fn scalar<R: XofReader>(reader: &mut R, order: U256) -> U256 {
    loop {
        let mut bytes = [0u8; 32];
        XofReader::read(reader, &mut bytes);
        let k = U256::from_le_bytes(bytes);
        // Rejection sampling, not modulo reduction: uniform in 1..order-1.
        if !k.is_zero() && k < order { return k; }
    }
}

type Point = (U256, U256);
#[derive(Clone, Debug, PartialEq)]
struct Input { target: Point, offset: Point, expected: Point }

fn accepted_pair(target: Point, offset: Point) -> bool {
    target != (U256::ZERO, U256::ZERO) && offset != (U256::ZERO, U256::ZERO)
        && target.0 != offset.0
}

fn generate_inputs<R: XofReader>(reader: &mut R, count: usize) -> Result<Vec<Input>, Failure> {
    let curve = secp256k1();
    let mut inputs = Vec::new();
    inputs.try_reserve_exact(count).map_err(|_| Failure::internal("input_allocation_failed"))?;
    while inputs.len() < count {
        let k1 = scalar(reader, curve.order);
        let k2 = scalar(reader, curve.order);
        let target = curve.mul(curve.gx, curve.gy, k1);
        let offset = curve.mul(curve.gx, curve.gy, k2);
        // Only the declared mathematical domain may reject a candidate pair.
        // The circuit is not read or executed here.
        if !accepted_pair(target, offset) { continue; }
        let expected = curve.add(target.0, target.1, offset.0, offset.1);
        inputs.push(Input { target, offset, expected });
    }
    Ok(inputs)
}

fn input_digest(inputs: &[Input]) -> [u8; 32] {
    let mut hasher = Sha3_256::new();
    for input in inputs {
        for value in [input.target.0, input.target.1, input.offset.0, input.offset.1] {
            Digest::update(&mut hasher, value.to_le_bytes::<32>());
        }
    }
    hasher.finalize().into()
}

fn live_mask(count: usize) -> u64 {
    assert!(count <= 64);
    if count == 64 { u64::MAX } else { (1u64 << count) - 1 }
}

fn record_batch(result: &mut ServerResult, count: usize, classical: u64, phase: u64, workspace: u64, stats: SimStats) {
    assert!(count <= BATCH_SIZE);
    let mask = live_mask(count);
    let (classical, phase, workspace) = (classical & mask, phase & mask, workspace & mask);
    let union = classical | phase | workspace;
    let base = result.executed_inputs;
    assert!(base + count <= NUM_INPUTS);
    for lane in 0..count {
        let bit = 1u64 << lane;
        let errors = u8::from(classical & bit != 0)
            | (u8::from(phase & bit != 0) << 1)
            | (u8::from(workspace & bit != 0) << 2);
        if errors != 0 { result.failure_inputs.push((base + lane, errors)); }
    }
    result.incorrect = Some(result.incorrect.unwrap_or(0) + union.count_ones() as usize);
    result.classical = Some(result.classical.unwrap_or(0) + classical.count_ones() as usize);
    result.phase = Some(result.phase.unwrap_or(0) + phase.count_ones() as usize);
    result.workspace = Some(result.workspace.unwrap_or(0) + workspace.count_ones() as usize);
    result.phase_batches = Some(result.phase_batches.unwrap_or(0) + usize::from(phase != 0));
    result.workspace_batches = Some(result.workspace_batches.unwrap_or(0) + usize::from(workspace != 0));
    result.executed_inputs += count;
    result.executed_batches += 1;
    result.total_toffoli = Some(stats.toffoli_gates);
    result.total_clifford = Some(stats.clifford_gates);
}

fn execute_inputs<R: XofReader>(ops: &[Op], regs: &[Vec<QubitOrBit>], total_qubits: u64,
    num_bits: u64, inputs: &[Input], measurement: &mut R, result: &mut ServerResult) -> Result<(), Failure> {
    result.failure_inputs.try_reserve_exact(NUM_INPUTS).map_err(|_| Failure::internal("error_detail_allocation_failed"))?;
    result.eligible_inputs = Some(inputs.len());
    result.incorrect = Some(0); result.classical = Some(0); result.phase = Some(0);
    result.workspace = Some(0); result.phase_batches = Some(0); result.workspace_batches = Some(0);
    let mut sim = Simulator::new(total_qubits as usize, num_bits as usize, measurement);
    let batches = inputs.len().div_ceil(BATCH_SIZE);
    for (batch_index, batch) in inputs.chunks(BATCH_SIZE).enumerate() {
        let mask = live_mask(batch.len());
        sim.clear_for_shot();
        for (lane, input) in batch.iter().enumerate() {
            sim.set_register(&regs[0], input.target.0, lane);
            sim.set_register(&regs[1], input.target.1, lane);
            sim.set_register(&regs[2], input.offset.0, lane);
            sim.set_register(&regs[3], input.offset.1, lane);
        }
        sim.apply_iter_masked(ops.iter(), mask);
        let mut classical = 0u64;
        for (lane, input) in batch.iter().enumerate() {
            if sim.get_register(&regs[0], lane) != input.expected.0
                || sim.get_register(&regs[1], lane) != input.expected.1 {
                classical |= 1u64 << lane;
            }
        }
        let phase = sim.phase & mask;
        // Workspace follows the original definition: non-register qubits must
        // return to zero. Classical scratch bits are not quantum workspace.
        for register in regs {
            for qb in register {
                if let QubitOrBit::Qubit(q) = *qb { *sim.qubit_mut(q) = 0; }
            }
        }
        // OR all workspace qubits; stopping at the first dirty qubit would
        // undercount inputs whose only dirty qubit occurs later.
        let workspace = sim.qubits.iter().fold(0u64, |acc, q| acc | q) & mask;
        record_batch(result, batch.len(), classical, phase, workspace, sim.stats);
        println!("completed batch {}/{}; inputs {}; incorrect inputs {}",
            batch_index + 1, batches, result.executed_inputs, result.incorrect.unwrap());
        // Do not stop early after errors: every input is always executed.
    }
    Ok(())
}

fn finalize_science(result: &mut ServerResult) {
    result.stage = "completed";
    result.update_score();
    if !result.coverage_complete() {
        result.fail(Failure::internal("incomplete_input_coverage"));
    } else if result.incorrect.is_none() || result.incorrect != Some(result.failure_inputs.len()) {
        result.fail(Failure::internal("inconsistent_error_details"));
    } else if result.incorrect.unwrap() > MAX_INCORRECT_INPUTS {
        result.status = "failed";
        result.failure_code = Some("incorrect_inputs_limit");
    } else {
        result.status = "passed";
        result.failure_code = None;
    }
}

fn evaluate(result: &mut ServerResult) -> Result<(), Failure> {
    let seed = load_seed(Path::new(SEED_PATH))?;
    result.seed = Some(seed);
    let ops = load_ops(Path::new(OPS_PATH))?;
    result.op_count = Some(ops.len() as u64);
    result.stage = "layout";
    let (total_qubits, num_bits, _num_regs, regs) = analyze_ops(ops.iter());
    result.qubits = Some(total_qubits);
    if regs.len() != 4 { return Err(Failure::rejected("unsupported_register_count")); }
    for r in &regs {
        if r.len() != 256 { return Err(Failure::rejected("unsupported_register_width")); }
    }
    for q in &regs[0] {
        if !matches!(q, QubitOrBit::Qubit(_)) { return Err(Failure::rejected("register_0_must_be_qubits")); }
    }
    for q in &regs[1] {
        if !matches!(q, QubitOrBit::Qubit(_)) { return Err(Failure::rejected("register_1_must_be_qubits")); }
    }
    for q in &regs[2] {
        if !matches!(q, QubitOrBit::Bit(_)) { return Err(Failure::rejected("register_2_must_be_bits")); }
    }
    for q in &regs[3] {
        if !matches!(q, QubitOrBit::Bit(_)) { return Err(Failure::rejected("register_3_must_be_bits")); }
    }
    result.stage = "testing";
    println!("platform random inputs {}; operations {}; Q index width {}", NUM_INPUTS, ops.len(), total_qubits);
    let mut input_stream = domain_xof(INPUT_DOMAIN, &seed);
    let inputs = generate_inputs(&mut input_stream, NUM_INPUTS)?;
    result.input_digest = Some(input_digest(&inputs));
    let mut measurement = domain_xof(MEASUREMENT_DOMAIN, &seed);
    execute_inputs(&ops, &regs, total_qubits, num_bits, &inputs, &mut measurement, result)?;
    finalize_science(result);
    println!("executed inputs {}; incorrect inputs {}; classical {}; phase inputs {}; workspace inputs {}",
        result.executed_inputs, result.incorrect.unwrap(), result.classical.unwrap(), result.phase.unwrap(), result.workspace.unwrap());
    println!("total executed Toffoli {}; total executed Clifford {}; rounded mean Toffoli {}; score {}",
        result.total_toffoli.unwrap(), result.total_clifford.unwrap(), result.rounded_mean_toffoli.unwrap(), result.score.unwrap());
    Ok(())
}

fn write_result(path: &Path, result: &ServerResult) -> std::io::Result<()> {
    let json = result.to_json();
    if json.len() > MAX_RESULT_BYTES { return Err(std::io::Error::other("result_size_limit")); }
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()
}

fn main() {
    println!("Quantum Cat platform executor {RELEASE_ID}");
    std::panic::set_hook(Box::new(|_| eprintln!("evaluator assertion raised; see structured failure code")));
    let mut result = ServerResult::new();
    if std::env::args_os().len() != 1 {
        result.fail(Failure::rejected("unexpected_arguments"));
    } else {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| evaluate(&mut result))) {
            Ok(Ok(())) => {},
            Ok(Err(failure)) => result.fail(failure),
            Err(_) => result.fail(Failure::internal("internal_panic")),
        }
    }
    println!("result status {}; stage {}; completed inputs {}", result.status, result.stage, result.executed_inputs);
    if let Some(code) = result.failure_code { eprintln!("failure code: {code}"); }
    if write_result(Path::new(RESULT_PATH), &result).is_err() {
        eprintln!("result_write_failed: result.json must be absent, writable and at most 128 KiB");
        std::process::exit(3);
    }
    std::process::exit(match result.status { "passed" => 0, "failed" | "rejected" => 1, _ => 2 });
}

#[cfg(test)]
mod software_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture { path: std::path::PathBuf }
    impl Fixture {
        fn bytes(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!("qcat-framing-software-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
            let mut file = OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
            file.write_all(bytes).unwrap();
            Self { path }
        }
        fn ops(records: &[[u8; OP_BYTES]]) -> Self {
            let mut bytes = MAGIC.to_vec();
            bytes.extend_from_slice(&(records.len() as u64).to_le_bytes());
            let body: Vec<u8> = records.iter().flat_map(|r| r.iter().copied()).collect();
            bytes.extend_from_slice(&zstd::stream::encode_all(&body[..], 1).unwrap());
            Self::bytes(&bytes)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_file(&self.path); } }
    fn record(kind: u32) -> [u8; OP_BYTES] {
        let mut bytes = [255u8; OP_BYTES];
        bytes[..4].copy_from_slice(&kind.to_le_bytes());
        bytes[4..8].fill(0);
        bytes
    }
    fn set(record: &mut [u8; OP_BYTES], offset: usize, value: u64) { record[offset..offset + 8].copy_from_slice(&value.to_le_bytes()); }
    fn reject_code(f: &Fixture) -> &'static str { load_ops(&f.path).unwrap_err().code }
    #[test]
    fn software_header_failures_do_not_start_scientific_checks() {
        assert_eq!(reject_code(&Fixture::bytes(b"short")), "truncated_header");
        assert_eq!(reject_code(&Fixture::bytes(&[0u8; 16])), "invalid_magic");
        let mut header = MAGIC.to_vec(); header.extend_from_slice(&0u64.to_le_bytes());
        assert_eq!(reject_code(&Fixture::bytes(&header)), "empty_operation_stream");
        header[8..].copy_from_slice(&(MAX_OPS + 1).to_le_bytes());
        assert_eq!(reject_code(&Fixture::bytes(&header)), "operation_count_limit");
    }

    #[test]
    fn software_bad_kind_and_original_operand_assertions_are_preserved() {
        assert_eq!(reject_code(&Fixture::ops(&[record(18)])), "unknown_operation_kind");
        let mut alias = record(13);
        set(&mut alias, 8, 0); set(&mut alias, 16, 0); set(&mut alias, 24, 0);
        assert_eq!(reject_code(&Fixture::ops(&[alias])), "invalid_operation_fields");
    }

    #[test]
    fn software_index_caps_reject_before_analyze_or_simulate() {
        let mut q = record(6); set(&mut q, 24, MAX_QUBITS);
        assert_eq!(reject_code(&Fixture::ops(&[q])), "qubit_index_limit");
        let mut b = record(4); set(&mut b, 32, MAX_BITS);
        assert_eq!(reject_code(&Fixture::ops(&[b])), "bit_index_limit");
        let mut r = record(1); set(&mut r, 48, MAX_REGISTERS);
        assert_eq!(reject_code(&Fixture::ops(&[r])), "register_index_limit");
    }

    #[test]
    fn software_register_and_condition_stack_memory_are_bounded() {
        let mut append = record(2); set(&mut append, 24, 0); set(&mut append, 48, 0);
        assert_eq!(reject_code(&Fixture::ops(&vec![append; 257])), "register_width_limit");
        let mut push = record(15); set(&mut push, 40, 0);
        assert_eq!(reject_code(&Fixture::ops(&vec![push; MAX_CONDITION_DEPTH + 1])), "condition_depth_limit");
    }

    #[test]
    fn software_trailing_decoded_data_and_short_records_are_rejected() {
        let mut header = MAGIC.to_vec(); header.extend_from_slice(&1u64.to_le_bytes());
        let mut bytes = header.clone(); bytes.extend_from_slice(&zstd::stream::encode_all(&[0u8; 1][..], 1).unwrap());
        assert_eq!(reject_code(&Fixture::bytes(&bytes)), "invalid_or_truncated_records");
        let mut r = record(1); set(&mut r, 48, 0);
        let mut body = r.to_vec(); body.push(0);
        header.extend_from_slice(&zstd::stream::encode_all(&body[..], 1).unwrap());
        assert_eq!(reject_code(&Fixture::bytes(&header)), "trailing_decoded_data");
    }

    #[test]
    fn software_compressed_input_size_is_bounded() {
        let f = Fixture::bytes(MAGIC);
        OpenOptions::new().write(true).open(&f.path).unwrap().set_len(MAX_COMPRESSED_BYTES + 1).unwrap();
        assert_eq!(reject_code(&f), "compressed_bytes_limit");
    }

    #[cfg(unix)]
    #[test]
    fn software_symlink_is_not_a_regular_upload() {
        let target = Fixture::bytes(b"synthetic fixture");
        let link = Fixture { path: target.path.with_extension("link") };
        std::os::unix::fs::symlink(&target.path, &link.path).unwrap();
        assert_eq!(reject_code(&link), "input_not_regular");
    }

    struct Bytes { bytes: Vec<u8>, offset: usize }
    impl XofReader for Bytes {
        fn read(&mut self, out: &mut [u8]) {
            out.copy_from_slice(&self.bytes[self.offset..self.offset + out.len()]);
            self.offset += out.len();
        }
    }
    fn scalars(values: &[U256]) -> Bytes {
        Bytes { bytes: values.iter().flat_map(|x| x.to_le_bytes::<32>()).collect(), offset: 0 }
    }
    fn point(input: &str) -> U256 { U256::from_str_radix(input, 16).unwrap() }

    #[test]
    fn software_seed_is_exactly_32_regular_bytes() {
        for len in [0, 1, 31, 33, 64] {
            assert_eq!(load_seed(&Fixture::bytes(&vec![42; len]).path).unwrap_err().code, "sampling_seed_length");
        }
        let f = Fixture::bytes(&[42; 32]);
        assert_eq!(load_seed(&f.path).unwrap(), [42; 32]);
        assert_eq!(load_seed(&f.path.with_extension("missing")).unwrap_err().code, "sampling_seed_missing");
        #[cfg(unix)] {
            let link = Fixture { path: f.path.with_extension("seed-link") };
            std::os::unix::fs::symlink(&f.path, &link.path).unwrap();
            assert_eq!(load_seed(&link.path).unwrap_err().code, "sampling_seed_not_regular");
        }
    }

    #[test]
    fn software_uniform_scalar_rejects_zero_order_and_above_without_modulo() {
        let order = secp256k1().order;
        let mut stream = scalars(&[U256::ZERO, order, order + U256::from(1), U256::MAX, U256::from(1), order - U256::from(1)]);
        assert_eq!(scalar(&mut stream, order), U256::from(1));
        assert_eq!(stream.offset, 5 * 32);
        assert_eq!(scalar(&mut stream, order), order - U256::from(1));
    }

    #[test]
    fn software_domain_filter_replenishes_pairs_before_any_circuit_execution() {
        let curve = secp256k1();
        let mut stream = scalars(&[U256::from(1), U256::from(1), U256::from(1), curve.order - U256::from(1),
            U256::from(1), U256::from(2), U256::from(2), U256::from(3)]);
        let inputs = generate_inputs(&mut stream, 2).unwrap();
        assert_eq!(stream.offset, 8 * 32);
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0].target, (curve.gx, curve.gy));
        assert_eq!(inputs[0].offset, (
            point("C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5"),
            point("1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52A")));
        assert_eq!(inputs[0].expected, (
            point("F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9"),
            point("388F7B0F632DE8140FE337E62A37F3566500A99934C2231B6CB9FD7584B8E672")));
        for input in inputs {
            assert!(accepted_pair(input.target, input.offset));
            assert!(curve.is_on_curve(input.target.0, input.target.1));
            assert!(curve.is_on_curve(input.offset.0, input.offset.1));
            assert!(curve.is_on_curve(input.expected.0, input.expected.1));
        }
        assert!(!accepted_pair((U256::ZERO, U256::ZERO), (curve.gx, curve.gy)));
        assert!(!accepted_pair((curve.gx, curve.gy), (U256::ZERO, U256::ZERO)));
    }

    #[test]
    fn software_digest_has_only_ordered_little_endian_coordinates() {
        let input = Input { target: (U256::from(1), U256::from(2)), offset: (U256::from(3), U256::from(4)), expected: (U256::ZERO, U256::ZERO) };
        let mut bytes = [0u8; 128];
        for i in 0..4 { bytes[i * 32] = (i + 1) as u8; }
        let expected: [u8; 32] = Sha3_256::digest(bytes).into();
        assert_eq!(input_digest(&[input.clone()]), expected);
        let mut changed_expected = input.clone(); changed_expected.expected = (U256::from(99), U256::from(100));
        assert_eq!(input_digest(&[input.clone()]), input_digest(&[changed_expected]));
        let mut swapped = input.clone(); std::mem::swap(&mut swapped.target, &mut swapped.offset);
        assert_ne!(input_digest(&[input]), input_digest(&[swapped]));
    }

    fn synthetic_complete(incorrect_mask: u64, phase_mask: u64, workspace_mask: u64) -> ServerResult {
        let mut result = ServerResult::new();
        result.eligible_inputs = Some(NUM_INPUTS); result.qubits = Some(10);
        for batch in 0..NUM_BATCHES {
            let n = BATCH_SIZE;
            record_batch(&mut result, n, if batch == 0 { incorrect_mask } else { 0 },
                if batch == 0 { phase_mask } else { 0 }, if batch == 0 { workspace_mask } else { 0 },
                SimStats { toffoli_gates: NUM_INPUTS as u64 * 5 / 2, clifford_gates: NUM_INPUTS as u64 * 7 });
        }
        finalize_science(&mut result);
        result
    }

    #[test]
    fn software_union_counts_each_input_once_and_preserves_stage_units() {
        let result = synthetic_complete(1, 1, 1);
        assert_eq!(result.status, "passed");
        assert_eq!(result.incorrect, Some(1));
        assert_eq!(result.classical, Some(1)); assert_eq!(result.phase, Some(1)); assert_eq!(result.workspace, Some(1));
        assert_eq!(result.phase_batches, Some(1)); assert_eq!(result.workspace_batches, Some(1));
        assert_eq!(result.failure_inputs, vec![(0, 7)]);
        let result = synthetic_complete(1, 2, 3);
        assert_eq!(result.status, "failed"); assert_eq!(result.incorrect, Some(2));
        assert_eq!(result.failure_code, Some("incorrect_inputs_limit"));
        assert_eq!(result.failure_inputs, vec![(0, 5), (1, 6)]);
        assert_eq!(result.executed_inputs, NUM_INPUTS);
    }

    #[test]
    fn software_phase_and_workspace_are_input_counts_not_batch_counts() {
        let result = synthetic_complete(0, u64::MAX, u64::MAX);
        assert_eq!(result.incorrect, Some(64)); assert_eq!(result.phase, Some(64)); assert_eq!(result.workspace, Some(64));
        assert_eq!(result.phase_batches, Some(1)); assert_eq!(result.workspace_batches, Some(1));
        assert_eq!(result.failure_inputs.len(), 64);
    }

    #[test]
    fn software_full_final_batch_counts_lane_63_at_index_10047() {
        let mut result = ServerResult::new();
        result.executed_inputs = 9984; result.executed_batches = 156;
        record_batch(&mut result, 64, 1u64 << 63, 1u64 << 63, 1u64 << 63, SimStats::default());
        assert_eq!(result.executed_inputs, 10048); assert_eq!(result.executed_batches, 157);
        assert_eq!(result.incorrect, Some(1)); assert_eq!(result.failure_inputs, vec![(10047, 7)]);
    }

    #[test]
    fn software_all_10048_synthetic_cases_execute_as_157_full_batches_with_exact_cost() {
        use quantum_ecc::circuit::{NO_BIT, NO_QUBIT, NO_REG};
        let regs = vec![vec![QubitOrBit::Qubit(QubitId(0))], vec![QubitOrBit::Qubit(QubitId(1))],
            vec![QubitOrBit::Bit(BitId(0))], vec![QubitOrBit::Bit(BitId(1))]];
        let ops = [Op { kind: OperationType::CCX, q_control1: QubitId(0), q_control2: QubitId(1), q_target: QubitId(2), c_target: NO_BIT, c_condition: NO_BIT, r_target: NO_REG },
            Op { kind: OperationType::R, q_control1: NO_QUBIT, q_control2: NO_QUBIT, q_target: QubitId(2), c_target: NO_BIT, c_condition: NO_BIT, r_target: NO_REG }];
        // Deliberately non-scientific zero-coordinate software fixtures. These
        // never pass the production input sampler and are not research evidence.
        let mut inputs = vec![Input { target: (U256::ZERO, U256::ZERO), offset: (U256::ZERO, U256::ZERO), expected: (U256::ZERO, U256::ZERO) }; NUM_INPUTS];
        for i in [0, 1, 10047] { inputs[i].expected.0 = U256::from(1); }
        let mut measurement = Bytes { bytes: vec![0u8; NUM_BATCHES * 8], offset: 0 };
        let mut result = ServerResult::new(); result.qubits = Some(3);
        execute_inputs(&ops, &regs, 3, 2, &inputs, &mut measurement, &mut result).unwrap();
        assert_eq!(measurement.offset, 157 * 8); // One R word per full 64-input batch.
        finalize_science(&mut result);
        assert_eq!(result.status, "failed"); assert_eq!(result.executed_inputs, 10048); assert_eq!(result.executed_batches, 157);
        assert_eq!(result.total_toffoli, Some(10048)); assert_eq!(result.total_clifford, Some(10048));
        assert_eq!(result.rounded_mean_toffoli, Some(1)); assert_eq!(result.score, Some(3));
        assert_eq!(result.failure_inputs, vec![(0, 1), (1, 1), (10047, 1)]);
    }

    #[test]
    fn software_score_uses_full_denominator_rounding_and_u64_saturation() {
        let mut r = synthetic_complete(0, 0, 0);
        assert_eq!(r.rounded_mean_toffoli, Some(3)); assert_eq!(r.score, Some(30));
        r.total_toffoli = Some(NUM_INPUTS as u64 * 5 / 2 - 1); r.update_score(); assert_eq!(r.rounded_mean_toffoli, Some(2));
        r.total_toffoli = Some(NUM_INPUTS as u64 * 5 / 2); r.qubits = Some(u64::MAX); r.update_score(); assert_eq!(r.score, Some(u64::MAX));
    }

    #[test]
    fn software_partial_execution_has_no_full_run_score_and_cannot_pass() {
        let mut r = ServerResult::new(); r.eligible_inputs = Some(NUM_INPUTS); r.qubits = Some(10);
        record_batch(&mut r, 64, 0, 0, 0, SimStats { toffoli_gates: 160, clifford_gates: 448 });
        finalize_science(&mut r);
        assert_eq!(r.status, "error"); assert_eq!(r.failure_code, Some("incomplete_input_coverage"));
        assert_eq!(r.score, None); assert_eq!(r.rounded_mean_toffoli, None); assert_eq!(r.total_toffoli, Some(160));
    }

    #[test]
    fn software_failure_preserves_completed_batch_error_units() {
        let mut r = ServerResult::new(); r.stage = "testing"; r.eligible_inputs = Some(NUM_INPUTS);
        record_batch(&mut r, 64, 3, 2, 0, SimStats::default());
        r.fail(Failure::internal("internal_panic"));
        assert_eq!(r.executed_inputs, 64); assert_eq!(r.incorrect, Some(2)); assert_eq!(r.phase, Some(1));
        assert_eq!(r.phase_batches, Some(1)); assert_eq!(r.failure_inputs, vec![(0, 1), (1, 3)]);
        assert!(r.to_json().contains("\"executedInputs\":64"));
        assert!(!r.to_json().contains("localPrecheck"));
    }

    #[test]
    fn software_largest_failure_detail_is_ordered_unique_and_under_128kib() {
        let mut r = ServerResult::new(); r.eligible_inputs = Some(NUM_INPUTS);
        for _ in 0..NUM_BATCHES { record_batch(&mut r, BATCH_SIZE, u64::MAX, u64::MAX, u64::MAX, SimStats::default()); }
        assert_eq!(r.failure_inputs.len(), 10048);
        for (i, &(index, mask)) in r.failure_inputs.iter().enumerate() { assert_eq!(index, i); assert_eq!(mask, 7); }
        let json = r.to_json(); assert!(json.len() < MAX_RESULT_BYTES);
        assert!(json.contains("[10047,7]")); assert!(json.contains("\"incorrectInputs\":10048"));
    }

    #[test]
    fn software_result_write_never_overwrites_and_unmeasured_values_stay_null() {
        let f = Fixture::bytes(b"keep prior bytes");
        let mut r = ServerResult::new(); r.fail(Failure::rejected("sampling_seed_length"));
        assert_eq!(write_result(&f.path, &r).unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&f.path).unwrap(), b"keep prior bytes");
        assert!(r.to_json().contains("\"incorrectInputs\":null"));
        assert!(r.to_json().contains("\"sampling\":null"));
        assert!(r.to_json().contains("\"tGates\":null"));
    }
    #[test]
    fn software_workspace_union_scans_every_qubit_not_only_first_dirty_one() {
        let regs = vec![vec![QubitOrBit::Qubit(QubitId(0))], vec![QubitOrBit::Qubit(QubitId(1))],
            vec![QubitOrBit::Bit(BitId(0))], vec![QubitOrBit::Bit(BitId(1))]];
        let cx = |target| Op { kind: OperationType::CX, q_control1: QubitId(0), q_target: QubitId(target), ..Op::empty() };
        let x = Op { kind: OperationType::X, q_target: QubitId(0), ..Op::empty() };
        let ops = [cx(2), x, cx(3), x];
        let inputs = vec![Input { target: (U256::from(1), U256::ZERO), offset: (U256::ZERO, U256::ZERO), expected: (U256::from(1), U256::ZERO) },
            Input { target: (U256::ZERO, U256::ZERO), offset: (U256::ZERO, U256::ZERO), expected: (U256::ZERO, U256::ZERO) }];
        let mut rng = domain_xof(MEASUREMENT_DOMAIN, &[0; 32]); let mut r = ServerResult::new();
        execute_inputs(&ops, &regs, 4, 2, &inputs, &mut rng, &mut r).unwrap();
        assert_eq!(r.classical, Some(0)); assert_eq!(r.workspace, Some(2)); assert_eq!(r.workspace_batches, Some(1));
        assert_eq!(r.failure_inputs, vec![(0, 4), (1, 4)]);
    }

    #[test]
    fn software_fixed_batch_boundaries_map_error_indices_by_sixty_four() {
        let mut r = ServerResult::new(); r.eligible_inputs = Some(NUM_INPUTS);
        for batch in 0..NUM_BATCHES {
            let phase = match batch { 0 => 1u64 << 63, 1 => (1u64 << 0) | (1u64 << 63), 156 => 1u64 << 63, _ => 0 };
            let workspace = if batch == 2 {1} else {0};
            record_batch(&mut r, BATCH_SIZE, 0, phase, workspace, SimStats::default());
        }
        assert_eq!(NUM_INPUTS, 10_000usize.div_ceil(64) * 64);
        assert_eq!(BATCH_SIZE, 64); assert_eq!(NUM_BATCHES, 157); assert_eq!(live_mask(BATCH_SIZE), u64::MAX);
        assert!(r.coverage_complete()); assert_eq!(r.executed_inputs, 10048); assert_eq!(r.executed_batches, 157);
        assert_eq!(r.failure_inputs, vec![(63, 2), (64, 2), (127, 2), (128, 4), (10047, 2)]);
        assert_eq!(r.phase, Some(4)); assert_eq!(r.phase_batches, Some(3));
        assert_eq!(r.workspace, Some(1)); assert_eq!(r.workspace_batches, Some(1));
        let phase_batches: std::collections::BTreeSet<_> = r.failure_inputs.iter().filter(|(_,mask)| mask & 2 != 0).map(|(index,_)| index / BATCH_SIZE).collect();
        assert_eq!(phase_batches.len(), r.phase_batches.unwrap());
        assert_eq!(phase_batches.into_iter().collect::<Vec<_>>(), vec![0, 1, 156]);
    }

    #[test]
    fn software_independent_python_vectors_match_streams_points_digest_and_replay() {
        let seed: [u8; 32] = std::array::from_fn(|i| i as u8);
        let mut input_stream = domain_xof(INPUT_DOMAIN, &seed);
        let mut measurement = domain_xof(MEASUREMENT_DOMAIN, &seed);
        let mut a = [0u8; 64]; let mut b = [0u8; 64];
        XofReader::read(&mut input_stream, &mut a); XofReader::read(&mut measurement, &mut b);
        assert_eq!(hex(&a), "8c2a08b34e12dc39227d0cb123966441e4c2c65fe26ac11b346ca838597ea15cbc610a0f102d082e32ca2db61eb28750c13ca632a4f73652a32958413f12b8ee");
        assert_eq!(hex(&b), "8e19e69771a4f2c74b525039be394039758977b327030ae9b08cf7b2d21d802449d63b8c142672faa6070a64d794c7312eef9650b22011eec3bea9309f59753d");
        assert_ne!(a, b);
        let inputs = generate_inputs(&mut domain_xof(INPUT_DOMAIN, &seed), 4).unwrap();
        assert_eq!(hex(&input_digest(&inputs)), "34acdaf2d878dec16161074506327138b609cdb985d724a80817e95a7f8c9f2b");
        let replay = generate_inputs(&mut domain_xof(INPUT_DOMAIN, &seed), 4).unwrap();
        assert_eq!(inputs, replay);
        assert_eq!(inputs[0].target, (point("fa35ce5ad7384a00279796e5b4c736dbdb06e4f8ea53d01bb09f0e2cec9e691e"), point("199e79514e638a95386c4b31781e4c7983d66da4395745be85c7111efbfa6484")));
        assert_eq!(inputs[0].offset, (point("cf93e2d89fc0e4273fb198cc0600857ebee08444dc8044d25f4d29f6d4867609"), point("5bb08a5b519bdb7531da2290a86583ed8c28e6309dab3f54caf834113808d09b")));
        assert_eq!(inputs[0].expected, (point("b71d958b6b1b377b8e52c973b24da531a97d05edf6d7d41456a7fc8102def9ea"), point("d4a6e28a51903a9a7ba5aa1def906c0d62a48c6455590d5cd74e7a5872fcad6f")));
        assert_eq!(inputs[1].target, (point("67f013eac0dfdac24787187b40cc6293bd312d52d6a4a4f12405c38be62c9a0b"), point("c4a36533ad8a06716c730e524d7627e52f4a0c694dcaa1b149df8ca1aa613b6c")));
        assert_eq!(inputs[1].offset, (point("f457750f3f13b91c8186b9e49795e0c1f71fdaf6bc87f631a8872d6f13337d6a"), point("973e3abf790a06832af5783c60bf2913115b1792986779fbda3778848fa4cab3")));
        assert_eq!(inputs[1].expected, (point("776a21876193a38fb88014c05ceefa1a30d79c009b25834191a22a25cf8eb2af"), point("4df82601f8707523236b2ff7f200af7692a13c2d4c96af5438685e79566a06e8")));
        assert_eq!(inputs[2].target, (point("eaad01b6ee4d74498ab798b6b0457e6f5b106bee96d7b2702ab44d1231cc12bd"), point("b58bffeafa19ad3999f6286a8510d01993d86e8e7ccdfe55e5847a3f863e14dd")));
        assert_eq!(inputs[2].offset, (point("326a9f11ff972f89b1211eddb94d0949297bf44e08805b0fc625d971b11b916b"), point("1cd6615fd14927951d53d92c4616fa4b9250a1c17dfd38e0d6657f338b85e707")));
        assert_eq!(inputs[2].expected, (point("8817ee34323eafcf9533289db69a83f4b2847a948327c3487740e9659a46b75f"), point("33f9e50b11e080d3927c41be7c8a994c7eaeb900f7f7b31b0477826d91f59a1f")));
        assert_eq!(inputs[3].target, (point("4ddcda45116434f93c286b5313516c8b61a4ddc4ba88138ed7e4c711a564f562"), point("8371b43b18cf13f860fcc2eba6bdf05c1cd7a23b95e18791fa333ddf61c528fc")));
        assert_eq!(inputs[3].offset, (point("e59fbfd8ef33f606c3215689802c71fbf4e54cad1f283bd6059434cb231688c4"), point("77e3563324375c2987c67f071d1eb57f3038f1f4dd589408a4163dcabd823447")));
        assert_eq!(inputs[3].expected, (point("d20305bbb1a2977cfa58f809ab9aee331bb52fec594cfc15bdc5405ca44f59b0"), point("fa4cfa2c95b17798df6da9bd40eb616d2b7bd27647dcf9908552c81ae617da75")));
    }

}
