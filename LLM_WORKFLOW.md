# Give this repository to a coding assistant

The coding assistant can use this repository and a scoped account API key to download an approved parent, improve it locally, run the complete precheck and submit a small circuit patch. The full compiled circuit remains on the researcher's computer. The server reconstructs it from the parent and patch before its independent check.

Use the API base `https://dev.qcat.io/api/v1`. Create the account and key at [dev.qcat.io](https://dev.qcat.io/); grant `circuits:read`, `submissions:write` and `submissions:read`. Give the key through the coding environment's secret or process environment facility. Keep it out of Git, source, reports, logs and shared prompts. Never paste it into a project file or URL.

## Instructions to give the assistant

> Clone `https://github.com/QCat-Dev/reversible-circuit-research-kit`, read `AGENTS.md`, `README.md`, `QUICKSTART.md`, `API.md` and `PUBLIC_POLICY.md`, and use `QCAT_API_URL=https://dev.qcat.io/api/v1` with my scoped API key held outside the repository. Install the locked dependencies and pinned verifier. Fetch the task manifest. List the publicly verified circuit summaries; if a qualified circuit exists, pull one by ID, preferably the current best. If the list is empty, pull archived Genesis once. Initialize a separate study from that exact downloaded parent and keep its manifest and SHA-256. Record the hypothesis and each attempt in `experiments/`. Change only the optimizer or independently licensed study source, not the verifier, task definition, inputs, sampling policy or checks. Build an incremental candidate. Confirm `build-receipt.json` says `delivery.mode: "qcat-delta-v1"`, the project selects `ops.qdelta`, and the patch is at most 16 MiB. Keep `ops.bin` local for the pinned 10,048-input run. If the build selects `full_circuit`, stop before submission, record `deltaRejection`, and try a closer publicly verified parent or a smaller change. Never upload `ops.bin` or manually rename it to `.qdelta`. Complete the method, research report, model/version declaration, runtime report, log and source ZIP. Run `check`, then `submit --development` only if the complete local result supports the claim. Return the submission ID, local/server check counts and measured Q/Toffoli score. A private receipt or precheck does not imply public qualification or a reward.

## Command sequence

```sh
npm ci
export QCAT_API_URL=https://dev.qcat.io/api/v1
# Supply QCAT_API_KEY securely in this process; do not commit it.
node bin/qcat.mjs task-manifest ../task-manifest.json
node bin/qcat.mjs list-verified ecc-point-addition
node bin/qcat.mjs history-verified ecc-point-addition
```

The catalog returns up to 20 small summaries per page. Use its `nextCursor` to fetch another page; circuit bytes are downloaded one parent at a time. When a publicly qualified result is available:

```sh
node bin/qcat.mjs pull-best ../verified-parent
node bin/qcat.mjs init ../my-study --baseline ../verified-parent/ops.bin
```

For a particular qualified version, use `pull VERIFIED_CIRCUIT_ID ../verified-parent`. If the qualified catalog is empty, use archived Genesis:

```sh
node bin/qcat.mjs pull-genesis ../genesis
node bin/qcat.mjs init ../my-study --baseline ../genesis/ops.bin
```

The first complete parent download may be large; later patch transfers are small when the exact parent is cached. `pull` checks the parent chain and reconstructed circuit hashes. An unqualified private submission is not a valid transport parent.

After documenting a bounded source change:

```sh
node bin/qcat.mjs build ../my-study
# Inspect ../my-study/build-receipt.json and require delivery.mode = qcat-delta-v1.
node bin/qcat.mjs pack-source ../my-study
cargo +1.93.0 build --locked --manifest-path verifier/Cargo.toml --release --bin qcat-server-eval
node bin/qcat.mjs record ../my-study --verifier /absolute/path/to/verifier/target/release/qcat-server-eval --verifier-version qcat-ecc-random-v2 --manifest ../task-manifest.json
node bin/qcat.mjs check ../my-study
node bin/qcat.mjs submit ../my-study --development
node bin/qcat.mjs status SUBMISSION_UUID
```

Use Node.js 24.15–24.x and Rust 1.93.0. The report must be the evaluator's actual completed report for this exact circuit and parameters. Preserve `.qcat-run-contexts` across retries. The kit refuses to `check` or `submit` a full circuit. `ops.qdelta`, `parameters.json`, `method.md`, `research-report.md`, `run-report.json` and `run.log` are mandatory; include `source.zip` for reproducibility and later public qualification. The server independently verifies the reconstructed circuit. Check [live verification availability](https://dev.qcat.io/api/v1/research/verification) and your owner-only status rather than assuming immediate public admission.
