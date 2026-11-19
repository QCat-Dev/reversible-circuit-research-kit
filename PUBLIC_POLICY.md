# Public qualification policy status

This page distinguishes public submission from public qualification. Every new package is submitted for public release if it qualifies; there is no private submission lane. The `submit --development` flag acknowledges that the submission is not yet a scientific qualification or reward entitlement.

## Proposed progression rule

For the first 100 **qualified public improvements**, a candidate needs a score improvement greater than zero and no more than **0.1%** against the current qualified public benchmark, plus at least **1,000,000 independent public verification inputs**. From the 101st qualified improvement onward, qualification requires an improvement greater than zero and at least **10,000,000 independent public verification inputs**, without the 0.1% upper cap. The comparison is `(current qualified benchmark score - candidate score) / current qualified benchmark score`, calculated with exact integer arithmetic and checked again at the end of the public round. This is a qualification progression limit, not a limit on how much a researcher may improve before submission.

The current kit performs a **10,048-input local precheck** and the server performs its own separate **10,048-input precheck**. Passing either or both does not count toward the million-input public threshold. A public submission receipt is not a verified circuit, leaderboard entry, on-chain record or reward entitlement. The live round remains blind: author identity is withheld from verifiers until qualification even though the submitted research is intended for public release.

Use the current [API interface](API.md) and [quickstart](QUICKSTART.md) for exact actions and environment availability. Policy terms are versioned; historical records without current public-release consent are not silently published.

## Compact submission boundary

The GitHub 0.10.5 client submits only a reproducible `ops.qdelta` tied to an archived or publicly verified parent. The complete `ops.bin` remains local for the pinned evaluator; the server reconstructs the same bytes from the parent and patch before independent verification. A `full_circuit` build receipt is a fail-closed submission result, not permission to upload the full file. This transport rule does not change correctness, score, public-verification or qualification requirements.
