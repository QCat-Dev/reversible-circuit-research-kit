# Research kit guidance for coding assistants

Read `README.md`, `QUICKSTART.md`, `LLM_WORKFLOW.md` and the generated study's `AGENTS.md` before changing a circuit. Work only on the published point-addition task and its pinned evaluation policy. Keep every hypothesis, source change, parameter set, result and rejection reason in the study's `experiments/` directory.

Use the complete kit or an authorized imported baseline. Edit the generated study's `src/optimize.mjs` or other separately licensed study source. Do not change the verifier, task manifest, assertions or validation rules. Do not choose inputs, seeds, folders or randomness to obtain a passing result. Preserve `.qcat-run-contexts` across retries.

A build receipt proves only that an artifact was built. Run the full 10,048-input local check, complete the required report and use `check` before `submit --development`. Accept an API key only through the coding environment's secret or environment facility. Never echo it or put it in source, logs, reports, generated prompts or commits. A private development receipt is not public qualification, chain registration or reward eligibility.
