# Work with a coding assistant

Give your coding assistant this repository URL, the API base `https://45.197.12.124/api/v1`, and an account API key with `circuits:read`, `submissions:write` and `submissions:read`. Create and verify the account on the [research platform](https://45.197.12.124/) first. Enter the key through the assistant's secret or environment feature when available. The assistant may use it for API calls, but must not print it, place it in source, reports, logs or commits, or send it to any other service. A fresh scoped key can be revoked in the account page after the study.

This repository is the framework. It has no Genesis binary. The assistant should clone the repository, inspect its rules, pull exactly one chosen baseline with the key, and work in a separate study directory. The one-time Genesis download is about 105 MB; qualified-circuit catalogs return small summaries, and individual compact records can transfer as patches. A new circuit without a reconstructible parent may require a full transfer.

## Give the assistant this task

> Clone the repository URL I supplied. Read `AGENTS.md`, `README.md`, `QUICKSTART.md`, `API.md` and `PUBLIC_POLICY.md`. Use the API base and scoped API key I supplied, without echoing or saving the key in the project. Set `QCAT_API_URL` and `QCAT_API_KEY` in the process environment. Install Node.js 24.15–24.x, Rust 1.93.0 and the locked Node dependencies. Download and check the task manifest. List references and qualified-circuit summaries, then choose either archived Genesis or one publicly qualified parent by ID. Download only that parent and verify its hash. Create a separate editable study with the pinned parent. Document each hypothesis, source revision, parameters and result in `experiments/`. Edit the study's circuit transformation source without changing the verifier, assertions, task manifest or sampling policy. Build, package source, compile the bundled verifier, run the complete 10,048-input local check, and complete the parameters, method, research report, AI model/version declaration, runtime report and runtime log. Run `check`; submit the unchanged package with `submit --development` only after the local report is complete. Report the submission ID, private server verification status, correctness counts and measured Q/Toffoli score. Do not claim public qualification from a private receipt. Never choose inputs or rotate a sampling context to obtain a pass.

## Exact command sequence

From the repository root, after making the key available to the process:

```sh
npm ci
export QCAT_API_URL=https://45.197.12.124/api/v1
node bin/qcat.mjs task-manifest ../task-manifest.json
node bin/qcat.mjs list-references
node bin/qcat.mjs list-verified ecc-point-addition
node bin/qcat.mjs history-verified ecc-point-addition
```

Each catalog page has at most 20 summaries; pass its returned `nextCursor` as the last argument to fetch another page. These calls do not bulk-download circuits. To start from Genesis in this repository clone:

```sh
node bin/qcat.mjs pull-genesis ../genesis
node bin/qcat.mjs init ../my-study --baseline ../genesis/ops.bin
```

If a publicly qualified result is available, use `pull-best ../parent` or `pull VERIFIED_CIRCUIT_ID ../parent` instead, then `init ../my-study --baseline ../parent/ops.bin`. The CLI checks the parent and any compact patch chain. The public catalog may be empty; a private development receipt does not appear in it. Do not use `pull-best` as a fallback when it returns empty.

After editing `../my-study/src/optimize.mjs` and recording the hypothesis:

```sh
node bin/qcat.mjs build ../my-study
node bin/qcat.mjs pack-source ../my-study
rustup toolchain install 1.93.0
cargo +1.93.0 build --locked --manifest-path verifier/Cargo.toml --release --bin qcat-server-eval
node bin/qcat.mjs record ../my-study --verifier /absolute/path/to/verifier/target/release/qcat-server-eval --verifier-version qcat-ecc-random-v2 --manifest ../task-manifest.json
node bin/qcat.mjs check ../my-study
node bin/qcat.mjs submit ../my-study --development
node bin/qcat.mjs status SUBMISSION_UUID
```

Use the actual absolute verifier path for your checkout. `build` creates a full local circuit and, when exact reconstruction is possible, selects a smaller patch for transfer. `pack-source` attaches the editable source and provenance. `record` creates the mandatory `run-report.json` and `run.log` from a real execution. Complete `qcat.project.json`, `method.md` and `research-report.md` before `check`; the templates intentionally contain missing fields. The report must name every AI model and exact version used, or declare no AI use. The server independently verifies the submitted circuit. Private status and original files are available through `status` and `download` with `submissions:read`.

## Submission boundary

Six artifacts are mandatory: a circuit patch or full circuit, `parameters.json`, `method.md`, `research-report.md` (or PDF), completed `run-report.json`, and `run.log`. Include `source.zip` through `pack-source`; it is optional for private intake but required for future public qualification. `check` generates the manifest and verifies file hashes and report structure. The server reconstructs the full circuit, runs its own check and preserves an immutable record. See [API.md](API.md) for exact routes, scopes, sizes and retry behavior.

The first-100 improvement cap described in [PUBLIC_POLICY.md](PUBLIC_POLICY.md) is a proposed rule for later public qualification. It is not currently enforced by `submit --development`; a private submission neither advances that counter nor appears on the public leaderboard. The current public library may be empty, so Genesis is the available starting point.
