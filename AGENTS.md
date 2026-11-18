# Research kit guidance for coding assistants

Read `README.md`, `QUICKSTART.md`, `LLM_WORKFLOW.md` and the generated study's `AGENTS.md` before changing a circuit. Work only on the published point-addition task and its pinned evaluation policy. Keep every hypothesis, source change, parameter set, result and rejection reason in the study's `experiments/` directory.

Use the complete kit or an authorized imported baseline. Edit the generated study's `src/optimize.mjs` or other separately licensed study source. Do not change the verifier, task manifest, assertions or validation rules. Do not choose inputs, seeds, folders or randomness to obtain a passing result. Preserve `.qcat-run-contexts` across retries.

A build receipt proves only that an artifact was built. Run the full 10,048-input local check, complete the required report and use `check` before `submit --development`. Accept an API key only through the coding environment's secret or environment facility. Never echo it or put it in source, logs, reports, generated prompts or commits. A private development receipt is not public qualification, chain registration or reward eligibility.

Compact-transfer rule for this GitHub client: keep the full `ops.bin` locally for evaluation, but submit only `ops.qdelta` plus the required small reports and source archive. Prefer the lowest-score publicly verified parent from `pull-best`; use archived Genesis when the verified catalog is empty. After `build`, inspect `build-receipt.json`: `delivery.mode` must be `qcat-delta-v1`. If it is `full_circuit`, do not call `check` or `submit`; record the reason, choose a closer verified parent or a smaller incremental optimization, and rebuild. Never rename `ops.bin` to `.qdelta` or edit the parent/hash fields by hand.
