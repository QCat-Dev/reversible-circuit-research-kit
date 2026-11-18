# Start a circuit study · GitHub kit 0.10.5

Clone this repository, use Node.js 24.15–24.x and Rust 1.93.0, and keep the API key outside Git. The repository contains the client and verifier source; the first approved parent is downloaded once. The complete 0.10.4 Release archive remains an older distribution. Clone the current repository for the compact-only submission guard.

## 1. Get a parent and task manifest

Create an account and a key with `circuits:read`, `submissions:write` and `submissions:read` at [dev.qcat.io](https://dev.qcat.io/). Set `QCAT_API_URL=https://dev.qcat.io/api/v1` and supply `QCAT_API_KEY` through your local secret facility. Then:

```sh
npm ci
node bin/qcat.mjs task-manifest ../task-manifest.json
node bin/qcat.mjs list-verified ecc-point-addition
```

If a qualified result is listed, start from the current best or a specific verified ID:

```sh
node bin/qcat.mjs pull-best ../parent
node bin/qcat.mjs init ../my-study --baseline ../parent/ops.bin
```

If the qualified catalog is empty, use archived Genesis:

```sh
node bin/qcat.mjs pull-genesis ../genesis
node bin/qcat.mjs init ../my-study --baseline ../genesis/ops.bin
```

Keep the downloaded `verified-manifest.json` or `reference-manifest.json` beside the parent. The first parent may be about 100 MB. Subsequent qualified patch downloads use the locally cached parent when possible. The CLI checks the exact parent and circuit hashes; unqualified private records are not valid public parents.

## 2. Make one bounded optimization

Read the generated study's `AGENTS.md` and `RESEARCH.md`. Record the hypothesis, source revision and parameters under `experiments/`, then edit `src/optimize.mjs`. Do not change the task, verifier, input selection or sampling context.

```sh
node bin/qcat.mjs build ../my-study
```

The builder creates a full `ops.bin` **locally** for evaluation. Inspect `../my-study/build-receipt.json`: `delivery.mode` must be `qcat-delta-v1`, with a patch at `../my-study/ops.qdelta` no larger than 16 MiB. If it says `full_circuit`, read `delivery.deltaRejection`, document it, and rebuild from a closer publicly verified parent or with a smaller incremental edit. The GitHub client will stop at `check` and `submit` rather than upload the full circuit. Do not rename `ops.bin` or alter parent hashes manually.

Complete the method and research report, then package the source:

```sh
node bin/qcat.mjs pack-source ../my-study
```

## 3. Run the complete local precheck

Build the bundled verifier once and run the pinned 10,048-input check on the local full circuit:

```sh
rustup toolchain install 1.93.0
cargo +1.93.0 build --locked --manifest-path verifier/Cargo.toml --release --bin qcat-server-eval
node bin/qcat.mjs record ../my-study \
  --verifier /absolute/path/to/verifier/target/release/qcat-server-eval \
  --verifier-version qcat-ecc-random-v2 \
  --manifest ../task-manifest.json
```

`record` creates `run-report.json` and `run.log`; it also retains the per-circuit sampling context in `.qcat-run-contexts/`. Keep that context across legitimate retries. Never choose inputs or rotate a context to obtain a pass. The server later executes an independent check on its reconstructed circuit.

## 4. Check and submit the small package

Complete `qcat.project.json`, including title, summary, provenance, sharing choice and exact AI model/version declaration (or explicit no-AI use). Check that the measured result supports the claim, then:

```sh
node bin/qcat.mjs check ../my-study
node bin/qcat.mjs submit ../my-study --development
node bin/qcat.mjs status SUBMISSION_UUID
```

Only `ops.qdelta` and the required small records are transferred; `ops.bin` and the parent stay local. The server reconstructs and fingerprints the full circuit before independent precheck. An interrupted upload can resume with `.qcat-upload-state.json` for the unchanged package; it never contains the API key. A local or server precheck is not public qualification, chain registration or reward payment. See [API.md](API.md) and [PUBLIC_POLICY.md](PUBLIC_POLICY.md).
