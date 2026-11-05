# Start a circuit study · kit 0.10.4

Clone this repository or extract the versioned framework ZIP. The source tree and framework ZIP contain the CLI and verifier source, but not the frozen Genesis circuit. A `circuits:read` API key can pull Genesis once. The complete Release ZIP includes Genesis as another option; verify its SHA-256 against `SHA256SUMS.txt`. Use Node.js 24.15–24.x and Rust 1.93.0. Keep the API key and local sampling contexts out of Git.

## 1. Prepare the project

Before running any API command against the current test server, set `QCAT_API_URL` to `https://45.197.12.124/api/v1`. In a Unix shell, run `export QCAT_API_URL=https://45.197.12.124/api/v1`. The CLI default `http://localhost:3000/api/v1` works only against a local Quantum Cat server. The `task-manifest` command below is an API command, even though it does not need a key.

From the repository or extracted `qcat-research-kit` directory:

```sh
npm ci
node bin/qcat.mjs init ../my-study
node bin/qcat.mjs task-manifest ../my-study/task-manifest.json
```

`task-manifest` downloads and checks the current `ecc-random-v2` definition without a key. If this is a repository clone or framework ZIP, set a `circuits:read` API key and run `node bin/qcat.mjs pull-genesis ../genesis`, then `node bin/qcat.mjs import-baseline ../my-study ../genesis/ops.bin`. The one-time Genesis transfer is about 105 MB. The complete ZIP imports its bundled Genesis automatically at `init`. No patch can be reconstructed without its exact parent circuit.

To continue an already qualified public result, run `node bin/qcat.mjs pull VERIFIED_ID ../verified-parent`, then `node bin/qcat.mjs init ../my-study --baseline ../verified-parent/ops.bin`. The matching `verified-manifest.json` pins its ID and SHA-256. `pull-best` can replace `pull VERIFIED_ID` when a qualified result exists. Today the public library is empty; archived Genesis is the available starting point.

## 2. Edit and build

Record your hypothesis in `../my-study/experiments/`. Edit `../my-study/src/optimize.mjs`, then:

```sh
node bin/qcat.mjs build ../my-study
node bin/qcat.mjs pack-source ../my-study
```

The build always creates a full local `ops.bin`. When the exact parent and output can be reconstructed, it also creates `ops.qdelta` and selects that small file in `qcat.project.json`. Inspect `build-receipt.json` and `delivery.mode`. A smaller operation count alone does not establish correctness or a lower resource score.

## 3. Run the local precheck

Build the bundled verifier source once:

```sh
rustup toolchain install 1.93.0
cargo +1.93.0 build --locked --manifest-path verifier/Cargo.toml --release --bin qcat-server-eval
```

Run the pinned 10,048-input check:

```sh
node bin/qcat.mjs record ../my-study \
  --verifier /absolute/path/to/qcat-research-kit/verifier/target/release/qcat-server-eval \
  --verifier-version qcat-ecc-random-v2 \
  --manifest ../my-study/task-manifest.json
```

The command creates the required `run-report.json` and `run.log`. It freezes the sampling context for this circuit and policy in `.qcat-run-contexts/`. Preserve that directory across legitimate retries. Do not choose or rotate inputs to obtain a pass. The server later performs its own independent check.

## 4. Complete and submit the record

Fill in `qcat.project.json`, `method.md` and `research-report.md`, including sources, reuse rights, exact AI model names and versions (or an explicit no-AI declaration), reproduction steps and limitations. Then:

```sh
node bin/qcat.mjs check ../my-study
```

Create an account and a scoped API key on the research platform. Set `QCAT_API_URL=https://45.197.12.124/api/v1` for the test server (local development defaults to `http://localhost:3000/api/v1`). Set `QCAT_API_KEY` in your shell, never in a project file. `submissions:write` is needed to submit; `submissions:read` reads private results; `circuits:read` browses and pulls circuits.

```sh
node bin/qcat.mjs submit ../my-study --development
node bin/qcat.mjs status SUBMISSION_UUID
node bin/qcat.mjs download SUBMISSION_UUID ../saved-record
```

The current intake creates a **private development** record. A completed author report and a server precheck do not make the circuit publicly qualified or eligible for chain registration. If the connection drops, retry the same unchanged project: `.qcat-upload-state.json` keeps upload IDs and a retry key but never stores the API key.

## Transfer sizes

The recorded Genesis-based experiment uploaded a 248,605-byte `ops.qdelta` rather than its approximately 96 MB compiled circuit. It still uploaded the required parameters, method, research report, runtime report and log, plus a small optional source ZIP. A fundamentally different circuit or an unsuccessful delta reconstruction requires a full circuit file. Verified public results with patches download their patch chain and reconstruct locally; an already cached immediate parent lets `pull` fetch only the newest patch. See [API.md](API.md) for endpoints and [README.md](README.md) for rules and limits.

## Download options

The complete kit is available through the account-protected Genesis card on the research platform. The framework ZIP contains the same client and verifier source without the Genesis binary. The versioned GitHub Release, when available, carries both ZIPs and `SHA256SUMS.txt`; check the downloaded file before use. See [DISTRIBUTION.md](DISTRIBUTION.md), [LLM_WORKFLOW.md](LLM_WORKFLOW.md) and [PUBLIC_POLICY.md](PUBLIC_POLICY.md).
