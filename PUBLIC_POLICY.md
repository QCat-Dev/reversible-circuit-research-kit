# Public qualification policy status

This page distinguishes the dev open-test score gate from the proposed production qualification policy. Neither is an extra rule in the current `submit --development` endpoint.

## Dev open-test admission

The server accepts a complete private development package and runs its own 10,048-input precheck even when the author reports no improvement. After that check, the dev public-test queue compares the **server-measured** score against the frozen Genesis test baseline of `10,254,267,954`. During the initial test progression, only a genuine improvement greater than zero and no more than 0.1% can enter that queue. A correct equal-score candidate remains in the author's private history and is marked `NO_IMPROVEMENT` for public queue admission. The Genesis test baseline is an archived reference, not a qualified public result.

An admitted circuit may receive two independent browser checks per fixed 64-input shard when a test round is active. These are test records. The dev environment disables qualification, chain registration and QCAT rewards; no NFT stake or wallet is needed for its signed-in browser volunteers.

## Proposed progression rule

For the first 100 **qualified public improvements**, a candidate would need a score improvement greater than zero and no more than **0.1%** against the current qualified public benchmark, plus at least **1,000,000 independent public verification inputs**. From the 101st qualified improvement onward, the proposal requires an improvement greater than zero and at least **10,000,000 independent public verification inputs**, without the 0.1% upper cap. The proposed comparison is `(current qualified benchmark score - candidate score) / current qualified benchmark score`, calculated with exact integer or rational arithmetic and checked again at the end of the public round. This is a qualification progression limit, not a limit on how much a researcher may improve a private candidate or submit for development review.

Production statistical qualification, reward and chain gates are still pending release. No qualified public improvement counter is active. The current kit performs a **10,048-input local precheck** and the server performs its own separate **10,048-input precheck**. Passing either or both does not count toward the proposed million-input public threshold. A private development receipt is not a verified public circuit, leaderboard entry, on-chain record or reward entitlement.

Use the current [API interface](API.md) and [quickstart](QUICKSTART.md) for actions that work now. A future production policy must be frozen and versioned before public qualification opens; this page does not grant a candidate admission.
