/// This file contains code for simulating kickmix circuits.


use crate::circuit::{BitId, Op, OperationType, QubitId, NO_BIT};
use ruint::aliases::U256;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SimStats {
    pub clifford_gates: u64,
    pub toffoli_gates: u64,
}



pub struct Simulator<'a, R: sha3::digest::XofReader> {
    pub phase: u64,
    pub qubits: Vec<u64>,
    pub bits: Vec<u64>,
    pub num_qubits: usize,
    pub num_bits: usize,
    pub xof: &'a mut R,
    pub stats: SimStats,
}

impl<'a, R: sha3::digest::XofReader> Simulator<'a, R> {
    pub fn new(num_qubits: usize, num_bits: usize, xof: &'a mut R) -> Self {
        let qubits = vec![0; num_qubits];
        let bits = vec![0; num_bits];

        Self {
            phase: 0,
            qubits,
            bits,
            num_qubits,
            num_bits,
            xof,
            stats: SimStats::default(),
        }
    }

    #[inline(always)]
    pub fn qubit(&self, id: QubitId) -> u64 {
        self.qubits[id.0 as usize]
    }

    #[inline(always)]
    pub fn qubit_mut(&mut self, id: QubitId) -> &mut u64 {
        &mut self.qubits[id.0 as usize]
    }

    #[inline(always)]
    pub fn bit(&self, id: BitId) -> u64 {
        self.bits[id.0 as usize]
    }

    #[inline(always)]
    pub fn bit_mut(&mut self, id: BitId) -> &mut u64 {
        &mut self.bits[id.0 as usize]
    }

    pub fn clear_for_shot(&mut self) {
        for e in &mut self.qubits {
            *e = 0;
        }
        for e in &mut self.bits {
            *e = 0;
        }
        self.phase = 0;
    }

    pub fn apply_iter<'b>(&mut self, ops: impl Iterator<Item = &'b Op>) {
        self.apply_iter_masked(ops, u64::MAX);
    }

    /// Applies operations only to lanes present in `live_mask`.
    /// Gate counts include only live, classically enabled lanes. R/Hmr still
    /// consume one full 64-bit measurement word per operation, even when its
    /// condition is empty, keeping the measurement stream precisely replayable.
    /// Inactive lanes are left unchanged. The condition stack never widens the
    /// root mask, including when an unmatched PopCondition is a no-op.
    pub fn apply_iter_masked<'b>(&mut self, ops: impl Iterator<Item = &'b Op>, live_mask: u64) {

        let mut condition_stack = Vec::new();
        let mut current_base_condition = live_mask;

        for op in ops {
            let mut cond = current_base_condition;
            if op.c_condition != NO_BIT {
                cond &= self.bit(op.c_condition);
            }

            let executed_shots = cond.count_ones() as u64;

            match op.kind {
                OperationType::CCZ | OperationType::CCX => {
                    self.stats.toffoli_gates += executed_shots;
                }
                OperationType::CX
                | OperationType::CZ
                | OperationType::Swap
                | OperationType::R
                | OperationType::Hmr => {
                    self.stats.clifford_gates += executed_shots;
                }
                // Note: X and Z are not considered Clifford gates in the
                // stats because they can be tracked in the classical control system.
                // They don't need to cause something to happen on the quantum computer.
                _ => {}
            }

            match op.kind {
                OperationType::CCX => {
                    let v = cond & self.qubit(op.q_control1) & self.qubit(op.q_control2);
                    *self.qubit_mut(op.q_target) ^= v;
                }
                OperationType::CX => {
                    let v = cond & self.qubit(op.q_control1);
                    *self.qubit_mut(op.q_target) ^= v;
                }
                OperationType::Swap => {
                    let mut q_c1 = self.qubit(op.q_control1);
                    let mut q_t = self.qubit(op.q_target);
                    q_c1 ^= q_t;
                    q_t ^= cond & q_c1;
                    q_c1 ^= q_t;
                    *self.qubit_mut(op.q_control1) = q_c1;
                    *self.qubit_mut(op.q_target) = q_t;
                }
                OperationType::X => {
                    *self.qubit_mut(op.q_target) ^= cond;
                }
                OperationType::CCZ => {
                    let v = cond
                        & self.qubit(op.q_target)
                        & self.qubit(op.q_control1)
                        & self.qubit(op.q_control2);
                    self.phase ^= v;
                }
                OperationType::CZ => {
                    let v = cond & self.qubit(op.q_target) & self.qubit(op.q_control1);
                    self.phase ^= v;
                }
                OperationType::Z => {
                    let v = cond & self.qubit(op.q_target);
                    self.phase ^= v;
                }
                OperationType::Neg => {
                    self.phase ^= cond;
                }
                OperationType::Hmr => {
                    let mut buf = [0u8; 8];
                    self.xof.read(&mut buf);
                    let rng_val = u64::from_le_bytes(buf);
                    *self.bit_mut(op.c_target) &= !cond;
                    *self.bit_mut(op.c_target) ^= rng_val & cond;
                    self.phase ^= self.qubit(op.q_target) & rng_val & cond;
                    *self.qubit_mut(op.q_target) &= !cond;
                }
                OperationType::R => {
                    let mut buf = [0u8; 8];
                    self.xof.read(&mut buf);
                    let rng_val = u64::from_le_bytes(buf);
                    self.phase ^= self.qubit(op.q_target) & rng_val & cond;
                    *self.qubit_mut(op.q_target) &= !cond;
                }
                OperationType::BitInvert => {
                    *self.bit_mut(op.c_target) ^= cond;
                }
                OperationType::BitStore0 => {
                    *self.bit_mut(op.c_target) &= !cond;
                }
                OperationType::BitStore1 => {
                    *self.bit_mut(op.c_target) |= cond;
                }
                OperationType::AppendToRegister
                | OperationType::Register
                | OperationType::DebugPrint => {}
                OperationType::PushCondition => {
                    condition_stack.push(current_base_condition);
                    current_base_condition &= self.bit(op.c_condition);
                }
                OperationType::PopCondition => {
                    if let Some(val) = condition_stack.pop() {
                        current_base_condition = val;
                    }
                }
            }
        }

    }

    /// Writes an integer into the qubits/bits of a register.
    ///
    /// Args:
    ///     reg: The qubits and bits making up the register, in little endian order.
    ///         CAUTION: Writes are unchecked!
    ///             Only pass in bits and qubits consistent with num_bits and num_qubits!
    ///         Caution: if a qubit or bit appears multiple times, the write to the more
    ///             significant bit position will overwrite prior writes.
    ///     val: The value to write into the bits/qubits.
    ///     shot_idx: The simulator tracks 64 shots in parallel. This is which shot to write to.
    pub fn set_register(
        &mut self,
        reg: &[crate::circuit::QubitOrBit],
        val: U256,
        shot_idx: usize,
    ) {
        for (i, item) in reg.iter().enumerate() {
            let bit_val = val.bit(i);
            match item {
                crate::circuit::QubitOrBit::Qubit(id) => {
                    if bit_val {
                        *self.qubit_mut(*id) |= 1 << shot_idx;
                    } else {
                        *self.qubit_mut(*id) &= !(1 << shot_idx);
                    }
                }
                crate::circuit::QubitOrBit::Bit(id) => {
                    if bit_val {
                        *self.bit_mut(*id) |= 1 << shot_idx;
                    } else {
                        *self.bit_mut(*id) &= !(1 << shot_idx);
                    }
                }
            }
        }
    }

    /// Reads the qubits/bits of a register as an integer.
    ///
    /// Args:
    ///     reg: The qubits and bits making up the register, in little endian order.
    ///         CAUTION: Reads are unchecked!
    ///             Only pass in bits and qubits consistent with num_bits and num_qubits!
    ///     shot_idx: The simulator tracks 64 shots in parallel. This is which shot to read from.
    ///
    /// Returns:
    ///     The requested integer.
    pub fn get_register(
        &self,
        reg: &[crate::circuit::QubitOrBit],
        shot_idx: usize,
    ) -> U256 {
        let mut v = U256::ZERO;
        for (i, item) in reg.iter().enumerate() {
            let bit_val = match item {
                crate::circuit::QubitOrBit::Qubit(id) => (self.qubit(*id) >> shot_idx) & 1,
                crate::circuit::QubitOrBit::Bit(id) => (self.bit(*id) >> shot_idx) & 1,
            };
            v.set_bit(i, bit_val != 0);
        }
        v
    }
}

#[cfg(test)]
mod mask_tests {
    use super::*;
    use crate::circuit::NO_REG;
    struct Words { words: Vec<u64>, cursor: usize }
    impl sha3::digest::XofReader for Words {
        fn read(&mut self, out: &mut [u8]) {
            assert_eq!(out.len(), 8);
            out.copy_from_slice(&self.words[self.cursor].to_le_bytes());
            self.cursor += 1;
        }
    }
    fn op(kind: OperationType, q: u64) -> Op {
        let mut op = Op::empty(); op.kind = kind; op.q_target = QubitId(q); op
    }
    fn conditional(kind: OperationType, q: u64, bit: u64) -> Op {
        let mut out = op(kind, q); out.c_condition = BitId(bit); out
    }
    fn toffoli() -> Op {
        let mut out = op(OperationType::CCX, 2); out.q_control1 = QubitId(0); out.q_control2 = QubitId(1); out
    }
    #[test]
    fn masked_sixteen_counts_only_live_lanes_and_preserves_48_inactive() {
        let mut rng = Words { words: vec![], cursor: 0 };
        let mut sim = Simulator::new(3, 0, &mut rng);
        sim.qubits = vec![u64::MAX, u64::MAX, 0xa5a5a5a5a5a50000];
        sim.apply_iter_masked([toffoli()].iter(), 0xffff);
        assert_eq!(sim.qubits[2], 0xa5a5a5a5a5a5ffff);
        assert_eq!(sim.stats.toffoli_gates, 16);
    }
    #[test]
    fn root_mask_is_preserved_across_nested_conditions_and_extra_pops() {
        let mut rng = Words { words: vec![], cursor: 0 };
        let mut sim = Simulator::new(3, 2, &mut rng);
        sim.qubits = vec![u64::MAX, u64::MAX, 0];
        sim.bits = vec![0xaaaa_aaaa_aaaa_aaaa, 0xcccc_cccc_cccc_cccc];
        let push = |b| Op { kind: OperationType::PushCondition, c_condition: BitId(b), ..Op::empty() };
        let pop = Op { kind: OperationType::PopCondition, ..Op::empty() };
        sim.apply_iter_masked([push(0), toffoli(), push(1), toffoli(), pop, toffoli(), pop, pop, toffoli()].iter(), 0xffff);
        assert_eq!(sim.stats.toffoli_gates, 8 + 4 + 8 + 16);
        assert_eq!(sim.qubits[2], 0x8888 ^ 0xffff);
        assert_eq!(sim.qubits[2] & !0xffff, 0);
    }
    #[test]
    fn masked_measurements_respect_condition_and_preserve_inactive_bits() {
        let mut rng = Words { words: vec![u64::MAX, 0xaaaa_aaaa_aaaa_aaaa, 0], cursor: 0 };
        {
            let mut sim = Simulator::new(2, 2, &mut rng);
            sim.qubits = vec![u64::MAX, u64::MAX]; sim.bits = vec![0x5555, 0xffff_ffff_ffff_0000];
            let mut hmr = conditional(OperationType::Hmr, 0, 0); hmr.c_target = BitId(1);
            let reset = conditional(OperationType::R, 1, 0);
            sim.apply_iter_masked([hmr, reset].iter(), 0xffff);
            assert_eq!(sim.bits[1], 0xffff_ffff_ffff_5555);
            assert_eq!(sim.qubits[0], !0x5555); assert_eq!(sim.qubits[1], !0x5555);
            assert_eq!(sim.phase, 0x5555);
            assert_eq!(sim.stats.clifford_gates, 16);
            // Zero-live calls still consume a word but cannot mutate or add cost.
            sim.apply_iter_masked([op(OperationType::R, 0)].iter(), 0);
            assert_eq!(sim.stats.clifford_gates, 16); assert_eq!(sim.qubits[0], !0x5555);
        }
        assert_eq!(rng.cursor, 3);
    }
    #[test]
    fn direct_conditions_gate_cost_per_live_lane() {
        let mut rng = Words { words: vec![], cursor: 0 };
        let mut sim = Simulator::new(3, 1, &mut rng); sim.qubits = vec![u64::MAX, u64::MAX, 0]; sim.bits[0] = u64::MAX ^ 5;
        let mut t = toffoli(); t.c_condition = BitId(0);
        sim.apply_iter_masked([t].iter(), 0xffff);
        assert_eq!(sim.stats.toffoli_gates, 14); assert_eq!(sim.qubits[2], 0xfffa);
    }
    #[test]
    fn all_operation_kinds_preserve_inactive_lanes_and_full_mask_wrapper() {
        let mut ops = Vec::new();
        for kind in [OperationType::Neg, OperationType::X, OperationType::Z, OperationType::CX, OperationType::CZ,
            OperationType::Swap, OperationType::CCX, OperationType::CCZ, OperationType::R, OperationType::Hmr,
            OperationType::BitInvert, OperationType::BitStore0, OperationType::BitStore1,
            OperationType::Register, OperationType::AppendToRegister, OperationType::DebugPrint] {
            let mut o = Op::empty(); o.kind = kind;
            match kind {
                OperationType::X | OperationType::Z | OperationType::R => o.q_target = QubitId(2),
                OperationType::CX | OperationType::CZ | OperationType::Swap => {o.q_target = QubitId(2);o.q_control1 = QubitId(0);},
                OperationType::CCX | OperationType::CCZ => {o.q_target = QubitId(2);o.q_control1 = QubitId(0);o.q_control2 = QubitId(1);},
                OperationType::Hmr => {o.q_target = QubitId(2);o.c_target = BitId(1);},
                OperationType::BitInvert | OperationType::BitStore0 | OperationType::BitStore1 => o.c_target = BitId(1),
                OperationType::Register => o.r_target = crate::circuit::RegisterId(0),
                OperationType::AppendToRegister => {o.r_target = crate::circuit::RegisterId(0);o.q_target = QubitId(2);},
                _ => {}
            }
            o.validate(); ops.push(o);
        }
        for mask in [0, 1, 0xffff, 0x8080_aaaa_5555_0101, u64::MAX] {
            for o in &ops {
                let mut ar = Words {words:vec![0xabcd_1234_7654_ffff], cursor:0};
                let mut br = Words {words:vec![0xabcd_1234_7654_ffff], cursor:0};
                let mut a = Simulator::new(3, 2, &mut ar); let mut b = Simulator::new(3, 2, &mut br);
                a.qubits = vec![0x3333_3333_3333_3333, 0xaaaa_aaaa_aaaa_aaaa, 0xcccc_cccc_cccc_cccc];
                a.bits = vec![u64::MAX, 0x5555_5555_5555_5555]; a.phase = 0x8888_8888_8888_8888;
                b.qubits = a.qubits.clone(); b.bits = a.bits.clone(); b.phase = a.phase;
                let before_q = a.qubits.clone(); let before_b = a.bits.clone(); let before_phase = a.phase;
                a.apply_iter_masked([*o].iter(), mask); b.apply_iter([*o].iter());
                for (i, &q) in a.qubits.iter().enumerate() {
                    assert_eq!(q & !mask, before_q[i] & !mask, "inactive qubit {:?}",o.kind);
                    assert_eq!(q & mask, b.qubits[i] & mask, "active qubit {:?}",o.kind);
                }
                for (i, &bit) in a.bits.iter().enumerate() {
                    assert_eq!(bit & !mask, before_b[i] & !mask); assert_eq!(bit & mask, b.bits[i] & mask);
                }
                assert_eq!(a.phase & !mask, before_phase & !mask); assert_eq!(a.phase & mask, b.phase & mask);
                if mask == u64::MAX { assert_eq!(a.stats, b.stats); }
                if mask == 0 { assert_eq!(a.stats, SimStats::default()); }
            }
        }
        assert_eq!(NO_REG.0, u64::MAX);
    }
}
