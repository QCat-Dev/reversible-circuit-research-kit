# Point-addition research task

Improve the **point-addition circuit** while preserving its computation on the current published task. The published circuit format is QECCOPSZ. A candidate is a locally compiled `ops.bin`, its build parameters, method, research report, and a completed machine-readable runtime report. When the circuit can be reconstructed from a pinned parent, submit the compact `ops.qdelta` instead of transferring `ops.bin`.

The editable lane is `src/optimize.mjs`. The starter pass cancels two adjacent identical self-inverse gates. The builder streams the baseline gate records through this pass. You may develop stronger passes, but each claim needs a stated correctness argument and a real evaluator run. You may instead build a complete circuit in your own source tree and import its `ops.bin` as a new baseline. The baseline must be a lawful, provenance-tracked artifact. The complete kit includes the frozen team Genesis baseline; the small framework ZIP omits it. No external repository source is redistributed.

## Start from team references or qualified community work

Set `QCAT_API_URL=https://45.197.12.124/api/v1` for the current test server, or use the local default only with a local Quantum Cat server. Set `QCAT_API_KEY` to an account API key with `circuits:read` before listing or downloading either team references or qualified community circuits. The complete starter archive contains the frozen Genesis binary once. The small framework ZIP does not contain it; use `pull-genesis` if you chose that archive.

```sh
node /path/to/qcat-research-kit/bin/qcat.mjs list-references
node /path/to/qcat-research-kit/bin/qcat.mjs init my-attempt
node /path/to/qcat-research-kit/bin/qcat.mjs task-manifest my-attempt/task-manifest.json
# If using the small framework ZIP only:
node /path/to/qcat-research-kit/bin/qcat.mjs pull-genesis ../genesis
node /path/to/qcat-research-kit/bin/qcat.mjs import-baseline my-attempt ../genesis/ops.bin
```

`pull-genesis` downloads the frozen **DONOR-I00-512-R255** compiled reference, verifies its exact 105,326,592 bytes and SHA-256, and saves `reference-manifest.json`. Importing it from that folder records both `parentCircuitId` and `parentCircuitSha256` in the research project. This 31,203,511-operation reference is within the **128 MiB / 40 million operation** limit shared by candidate output, local checks, uploads and independent server verification. Importing or rebuilding it does not count as a passing run: a completed current local report and separate server precheck are still required.

The archived Genesis study observed **0 errors in 1,024,000 fresh random inputs**. That archived result is statistical evidence on a frozen historical corpus, not a mathematical proof. A later native local run of the exact Genesis binary completed 10,048/10,048 inputs with 0 errors under the current task policy; independent server precheck of that exact binary remains separate. The optimized comparison reference observed **1 error in 1,024,000** and must not be described as zero-error. Both records show the source revision, frozen parameters, circuit hash and the evidence limitation. The archive's full generation environment is recorded in its `revision.freeze.json`; the short parameter list in the public manifest alone is not a reproduction recipe. Importing either circuit does not grant a new submission a passing report.

The separate qualified community library is queried with:

```sh
node /path/to/qcat-research-kit/bin/qcat.mjs list-verified ecc-point-addition
node /path/to/qcat-research-kit/bin/qcat.mjs history-verified ecc-point-addition
node /path/to/qcat-research-kit/bin/qcat.mjs pull-best ../verified-best
node /path/to/qcat-research-kit/bin/qcat.mjs pull VERIFIED_ID ../verified-older
```

Each qualified list page contains at most 20 summaries and no circuit bytes. To continue from a pulled qualified version, run `init next-attempt --baseline ../verified-best/ops.bin`; the matching `verified-manifest.json` pins its ID and hash so the next build can generate a small delta. `QCAT_BASELINE_PATH` may point to an already cached immediate parent when pulling a later version. The community library remains empty until a submission passes its own platform and public qualification gates. Do not describe a team reference as a qualified community submission.

For private status/download, use `submissions:read`. To submit a new package, use `submissions:write`. Keep keys outside this project and its ZIP. A changed candidate needs its own complete local report and independent server check.

## Reproduce an attempt

1. Record the hypothesis, source revision, baseline hash and intended change under `experiments/`.
2. Build with `node /path/to/qcat-research-kit/bin/qcat.mjs build .` from the project directory.
3. Review `build-receipt.json`: operation counts and hashes are build facts, **not** correctness or a score.
4. Fetch the task manifest with `task-manifest my-attempt/task-manifest.json`; build the pinned verifier from the kit source, then run `record` with those exact files. This executes 10,048 random inputs. Do not choose inputs, seeds, or retry contexts for a better outcome.
5. Complete `method.md`, `research-report.md` and `qcat.project.json`. Run `check`, then use the website or `submit --development` for private receipt. The server executes a separate precheck.

Keep every attempt, including failures, with its source hash, exact parameters, build receipt, report/log paths, error counts, Q/cost figures if available and conclusion. Archive previous output files before rebuilding. Keep `.qcat-run-contexts` in place. The platform precheck uses 10,048 random inputs; results from another benchmark do not substitute for this run.

If using the [Layr-Labs public challenge](https://github.com/Layr-Labs/ecdsafail-challenge) locally as a source starting point, obey its own rules and licensing. Do not republish its source or mark its fixed-corpus results as Quantum Cat qualification. Bring only an artifact that you have the right to use, with its origin and reproducible build method recorded.
