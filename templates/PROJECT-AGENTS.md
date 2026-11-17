# Research agent instructions

Work on the published point-addition task and its published evaluation protocol. Edit `src/optimize.mjs` or your own separately licensed circuit source. Preserve semantic correctness and report every attempt, including failures, under `experiments/` with the source revision, parameters, baseline and output hashes, corpus/policy, correctness counts, Q/resource cost, conclusion and artifact/log paths.

Do not select test inputs, seeds or randomness to seek a passing result. Do not alter the verifier, task manifest, assertions or validation policy. Do not treat a smaller gate count as proof of correctness. Do not claim qualification from a local run: server evidence is independent, and public admission is separate. Do not upload an unverified candidate or credentials. Keep API keys outside the project.

Use `list-verified` or `history-verified` for bounded public summaries, then `pull-best` or `pull <id>` for one approved version. Verified-circuit summaries and circuit/source downloads require a `circuits:read` API key; private downloads and submission need their own appropriately scoped key. If the public list is empty, report that no verified starting circuit is available. Preserve the chosen version ID, task version, license and SHA-256 fingerprints in the experiment record; recheck every changed candidate independently.

Before each change, read `RESEARCH.md` and the kit guide. Archive the preceding candidate, report and log; retain `.qcat-run-contexts`. State the hypothesis, modify the editable source, build, run the pinned local precheck, then record measured results and any rejection reason. If using an external repository, follow its license and challenge-specific rules separately.
