# Public qualification policy status

This page distinguishes the proposed public qualification policy from the currently available private research intake. It is not an extra rule in the current `submit --development` endpoint.

## Proposed progression rule

For the first 100 **qualified public improvements**, a candidate would need a score improvement greater than zero and no more than **0.1%** against the current qualified public benchmark, plus at least **1,000,000 independent public verification inputs**. From the 101st qualified improvement onward, the proposal requires an improvement greater than zero and at least **10,000,000 independent public verification inputs**, without the 0.1% upper cap. The proposed comparison is `(current qualified benchmark score - candidate score) / current qualified benchmark score`, calculated with exact integer or rational arithmetic and checked again at the end of the public round. This is a qualification progression limit, not a limit on how much a researcher may improve a private candidate or submit for development review.

The public verification allocation, statistical decision rule, first benchmark and qualification gate are still pending implementation and release. No public improvement counter is active. The current kit performs a **10,048-input local precheck** and the server performs its own separate **10,048-input precheck**. Passing either or both does not count toward the proposed million-input public threshold. A private development receipt is not a verified public circuit, leaderboard entry, on-chain record or reward entitlement.

Use the current [API interface](API.md) and [quickstart](QUICKSTART.md) for actions that work now. A future production policy must be frozen and versioned before public qualification opens; this page does not grant a candidate admission.
