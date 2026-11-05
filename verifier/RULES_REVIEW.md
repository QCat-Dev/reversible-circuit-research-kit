# Final random-policy definition: 10,048 inputs in 64-lane batches

This newly versioned Quantum Cat policy is separate from upstream contest rules. The prior 16-lane draft was based on a misunderstanding corrected by the user before scientific execution; it is superseded. No previous result is relabelled.

| Aspect | Frozen rule |
| --- | --- |
| Identity | qcat-ecc-random-v2 / ecc-random-v2 / qcat-ecc-random-10048-v1 / qcat-server-result-v2 |
| Rationale | A u64 bit-sliced simulator processes 64 independent lanes; this is a software width, not a quantum constraint |
| Count | ceil(10000/64)*64 = 10048; all 10048 are real sampled/executed inputs, never 9984 or padding |
| Batches | Exactly 157 full batches, BATCH_SIZE=64, normal live mask u64MAX, input i maps to batch floor(i/64) |
| Seed | Exactly 32 regular-file bytes; server/client creates once and freezes; no CLI/env/default/reselection |
| Input XOF | SHAKE256(UTF8 qcat-ecc-random-10048-v1/inputs || seed), with no extra framing |
| Scalars | Sequential 32-byte LE rejection sampling, 1 <= k < secp256k1 order; no modulo reduction |
| Domain | Two non-infinity generator multiples, unequal x; only mathematical-domain exclusions, before circuit execution |
| Digest | SHA3-256 of accepted-order target.x,target.y,offset.x,offset.y, each 32-byte LE, no prefix |
| Measurements | Separate SHAKE256 qcat-ecc-random-10048-v1/measurement || seed; each R/Hmr consumes one u64 per batch even if disabled; all 64 bits address live lanes |
| Simulator | Existing masked primitive remains; all production batches use full mask; operation bodies and assertions unchanged |
| Errors | Classical=1, phase=2, quantum workspace=4; OR per input; separate stage input and affected-batch counts |
| Workspace | OR all non-register quantum qubits; classical scratch bits are not required to be zero |
| Verdict | Execute all 10048 even after failures; complete union<=1 passes, complete union>1 fails; incomplete/internal execution is error |
| Details | Ordered unique [index,mask] rows, index 0..10047, masks 1..7, max 10048 rows; output <=128 KiB |
| Cost | True executed gate totals; denominator 10048; f64 round then u64 saturating product with Q; T null |
| Guards | Existing bytes/ops/Zstd/index/layout/depth/memory limits, create-new report output, caller resource isolation |

The changed version/domain strings deliberately produce a new corpus for a given seed. The sampling method, reference arithmetic and scalar-domain filter stay the same. No data from a circuit's result can influence sampling. The accepted point-addition domain excludes equal-x doubling/inverse pairs as before.

Software evidence comprises 28 Rust tests and independent Python small-vector regeneration. Tiny synthetic bookkeeping fixtures are not valid scientific evidence and do not qualify a real circuit. No real scientific run has been performed for this source package; all real stage counts/Q/Toffoli/T/score are unmeasured. No upload occurred.

The QA seed generated before this correction is retained unchanged for the separately authorized single future run. Neither prior random-policy draft received a scientific POST. Future execution must bind this exact source/release/domain and report actual 10048/157 coverage, rather than reuse historical draft totals.
