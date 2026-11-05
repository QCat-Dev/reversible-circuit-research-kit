# Quantum Cat platform evaluator: 10,048 random inputs

Release **qcat-ecc-random-v2**; task **ecc-random-v2**; policy **qcat-ecc-random-10048-v1**; native result schema **qcat-server-result-v2**.

This is the independent Quantum Cat platform's policy, not the upstream public challenge's fixed-corpus rule. Earlier platform drafts and fixed-policy evidence must retain their original identities. No upstream rule is changed and no equivalence claim is made.

## Why 64, and why 10,048

The simulator uses bit slicing: one `u64` stores the same simulated qubit/bit across 64 independent input cases, and a bitwise operation processes those 64 lanes together. **64 is a software representation width, not a quantum-hardware threshold or a scientific requirement.** Using full words gives a fixed batch shape and avoids inactive/padded lanes.

The requested minimum of 10,000 inputs is rounded **up** to the next full batch: `ceil(10000 / 64) * 64 = 10048 = 157 * 64`. All **10,048** inputs are sampled, executed, included in error counts, and included in the score denominator. The extra 48 are real tests, not padding. The count is never rounded down to 9,984.

Every production batch has 64 live lanes and mask `u64::MAX`. Index `i` belongs to batch `floor(i / 64)` and lane `i % 64`. There is no partial production batch. The generic masked simulator entry remains available and tested at smaller masks, but production uses full 64-lane batches.

## Data-only process contract

Build executable `qcat-server-eval` and run it with **no arguments** in a directory containing:

- Immutable `ops.bin`, QECCOPSZ circuit data, at most 128 MiB compressed. The fixed simulator interprets it. No author source, scripts, build commands or executables are loaded.
- `sampling-seed.bin`, a regular non-symlink file of **exactly 32 bytes**. The evaluator has no default seed, seed search, CLI/env seed or automatic reseeding.
- Absent `result.json`. Output uses create-new semantics, is flushed, and cannot exceed 128 KiB.

The server/client generates its seed once with an OS cryptographic random generator, persists it before execution, and reuses it for retries. Independent server evidence requires server-owned seed creation and binding. Author input or a self-reported result is not independent evidence. The runner binds circuit hash, seed, task manifest, source/binary identity, result and raw log. It also enforces container isolation, process deadline, CPU/memory and log limits. A terminated process without a final report never counts as a pass.

Exit status: 0=passed; 1=scientific failed or rejected data; 2=internal execution error; 3=result could not be written. Static format/layout/limit errors are rejected, while allocation or execution errors remain infrastructure failures. Completed-batch counters survive caught errors; an OOM/signal can leave no final report.

## Exact sampling and replay

1. Input stream: SHAKE256 over UTF-8 `qcat-ecc-random-10048-v1/inputs`, directly followed by the 32 seed bytes. There is no separator, length, circuit hash or extra prefix.
2. Read 32 bytes from the continuous stream as an unsigned little-endian integer. Reject zero or values at/above secp256k1.order, continuing the same stream, until `1 <= k < order`. This is uniform rejection sampling, not modulo reduction.
3. Draw k1, then k2. Compute target=k1*G and offset=k2*G using the frozen secp256k1 reference arithmetic.
4. Reject the pair only when either point is infinity `(0,0)` or both x coordinates coincide. Draw a new pair until exactly 10,048 valid pairs are collected. The circuit is never consulted during this mathematical-domain filtering, and a failed circuit never causes reseeding.
5. Reference output is target+offset. Accepted-input order gives zero-based indexes 0..10047.
6. `inputDigest` is SHA3-256 over all accepted inputs in order, each contributing target.x,target.y,offset.x,offset.y as four fixed 32-byte little-endian coordinates. No prefix, separators or reference outputs are hashed. The digest stays null until the complete input set exists.
7. Measurement stream: separate SHAKE256 over UTF-8 `qcat-ecc-random-10048-v1/measurement` directly followed by the same seed. The stream continues across all 157 batches. Every encountered R/Hmr consumes one little-endian u64 even when classically disabled. All 64 bits map to the batch's 64 lanes; only classically enabled lanes have effects/cost. Input rejection never consumes measurement-stream bytes.

Both domains changed for this new version, so an old draft's corpus/digest/outcome must not be relabelled. Reusing a previously frozen seed is valid; no search or result-driven seed change is permitted.

`tests/sampling_vectors.py` independently derives four fixed software cases using Python standard-library SHAKE/SHA3 and separate affine reference arithmetic. `sampling-vectors.json` records both stream prefixes, inputs, expected outputs and digest. Rust tests compare every value and repeat replay. These small vectors test software; they are never treated as a complete scientific run.

## Errors, complete coverage and verdict

Every accepted input executes, even after errors. Per-input error bits are:

| Bit | Meaning |
| --- | --- |
| 1 | Target output x or y differs from the reference sum |
| 2 | Nonzero residual phase bit |
| 4 | Any non-register quantum workspace qubit remains nonzero |

All workspace qubits are ORed before counting. Declared registers are excluded from quantum workspace; classical scratch bits are not required to return to zero. This retains the original workspace meaning and does not independently add offset-bit preservation checks.

Stage input counts stay separate. `incorrectInputs` counts the union, so one input with all three errors counts once. Phase/workspace batch counts are the number of distinct affected `floor(index/64)` values.

A pass requires exactly 10,048 eligible/executed inputs, 157 completed batches, and union error count **<=1**. A complete run with more than one incorrect input is `failed/incorrect_inputs_limit`. Incomplete coverage or interruption is `error`, not a scientific failure/pass. A tolerated error is still present in the report; consumers must not call it zero-error success.

`failureDetails` is always `{ "encoding":"index-error-mask-v1", "inputs":[[index,mask],...] }`. Entries are unique, ordered, and exactly match the error union. Index range is 0..10047, mask range 1..7, maximum 10,048 entries. Pre-execution rejections have empty details and null unmeasured counters. No large raw coordinate diagnostics are printed. The worst complete error list fits the enforced 128 KiB output bound.

## Resource accounting

Resource values are decimal strings or null. Costs count actual live and classically enabled operations. Complete runs calculate `round(f64(totalExecutedToffoli) / 10048)`, then a saturating-u64 product with Q. Partially completed runs retain measured cost totals but no full-run mean/score. `tGates` remains null; no unproved Toffoli-to-T conversion is invented. The schema has no `localPrecheck` field or implied second check.

Bounds: 128 MiB compressed input; 40,000,000 operations of 56 serialized bytes (2,240,000,000 expanded); 128 MiB Zstd window; 65,536 qubit indexes and 4,194,304 classical-bit indexes; four 256-bit registers; condition depth 4,096; 3 GiB estimated native allocation. Every original operation assertion is active. Actual aggregate gate counts are at most 401,920,000,000 under these caps, below the exact-integer limit of f64/JavaScript Number.

## Build and verification of the software

Pin cargo, rustc and rustdoc to Rust **1.93.0**. With locked dependencies already cached:

```sh
cargo test --locked --offline
cargo build --release --locked --offline
python3 tests/sampling_vectors.py
```

Deployment can install `target/release/qcat-server-eval` as `/usr/local/bin/qcat-evaluator`. Root builds the Linux image separately. The tests use synthetic fixtures only; they cover full 10,048-input/157-batch bookkeeping, exact costs and measurement-word consumption, the last live lane, index-to-batch boundaries, <=1 error tolerance, union counting, conditional gates, mask boundaries, loader limits, score and bounded output. No real candidate is bundled or scientifically evaluated by these tests.

## Provenance and correction history

Immediate base is the superseded 16-lane draft source `6614e15bef1375ce0d9888191e88782370d4a95904189461badb6131aa0c50a6`, itself derived from the public challenge's fixed-policy adapter. The user corrected the intended multiple to 64 before any new random-policy scientific POST was sent. The earlier 16-input execution setting was a misunderstanding and is superseded, not an alternative supported production mode.

The reference curve, parser/operation assertions, allocation guardrails and generic simulator production operations are unchanged. This release intentionally changes total count, batch size, coverage, error-index grouping, cost denominator, version IDs and domain strings; software vectors/docs change accordingly. `RULES_REVIEW.md`, `SCIENTIFIC_DEFINITION.json` and `NOTICE` document these changes. Old package/evidence files remain historical.

`SOURCE_MANIFEST.json` hashes all package sources/docs/vectors except itself and generated target files. Directory identity is SHA-256 of sorted UTF-8 lines `relative/path<TAB>file_sha256<LF>`. It identifies source contents, not a scientific result or running-binary attestation.
