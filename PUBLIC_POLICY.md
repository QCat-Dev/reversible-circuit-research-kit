# Public research progression on the development network

The research API accepts an immutable package and performs an independent 10,048-input server precheck. That is preliminary evidence. Public qualification requires a separate round of independent verification, review and the current score rule. Chain proof registration and reward claims are later stages; they must be checked separately on the live service.

## Score rule

A candidate must have a lower server-measured score than the current qualified baseline. For the first 100 qualified improvements, the gain must also be no more than 0.1% of that baseline, calculated with exact integers: `(baselineScore - candidateScore) * 1000 <= baselineScore`. The baseline advances only after a public qualification; the server checks eligibility again when the public round settles. A submission outside that window may still have an owner-visible private precheck record, but it cannot enter or complete the public improvement queue under this rule.

The current baseline and completed advance count can change. Read the live queue, leaderboard and owner evidence instead of copying a score from this document. A previously submitted circuit, an archived reference and a publicly qualified circuit are different statuses.

## Public verification threshold

For the first 100 qualified improvements, a circuit needs at least 1,000,000 independently checked public inputs. From the 101st onward, the target is at least 10,000,000. Assigned work is completed by eligible independent verifiers under the server's frozen protocol; the author cannot choose inputs or substitute a local run. The author and server 10,048-input prechecks do not count toward this public threshold. Zero reviewed errors and no unresolved scientific dispute are required before qualification.

## Transfer rule in this GitHub kit

`build` keeps a full `ops.bin` locally so the pinned verifier can run. The GitHub client uploads only `ops.qdelta` against an archived or publicly verified parent, plus the required reports and source archive. `check` and `submit` reject a full circuit. If `build-receipt.json` reports `delivery.mode: "full_circuit"`, inspect `deltaRejection`, record the attempt, and make a smaller incremental change from a closer publicly verified parent. Never edit a parent fingerprint or rename the binary to bypass the patch check. The server independently reconstructs and validates the full circuit.

See the [live verification capability](https://dev.qcat.io/api/v1/research/verification), [challenge queue](https://dev.qcat.io/api/v1/challenges/ecc-point-addition/queue) and [API guide](API.md) for current state and routes. Public qualification, on-chain registration and reward payment must each be observed separately.
