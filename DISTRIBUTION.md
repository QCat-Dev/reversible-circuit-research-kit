# Research kit downloads and integrity

The existing **0.10.4** Release has two archives. Clone current GitHub main for the **0.10.5 compact-only submission guard**; the older archives do not include it:

| Archive | Contents | Starting point |
| --- | --- | --- |
| `qcat-research-kit-complete-v0.10.4-open-test.2.zip` | Client, schemas, editable study template, verifier source and frozen Genesis | Optional one-time starter |
| `qcat-research-kit-framework-v0.10.4-open-test.2.zip` | Same framework without Genesis | Use `pull-genesis` with a `circuits:read` API key or import an authorized baseline |

The account-protected [Genesis card](https://dev.qcat.io/research/circuits) serves the complete starter. A repository clone can use `pull-genesis` to fetch the same frozen baseline with an API key. The versioned GitHub Release also provides both archives and `SHA256SUMS.txt` when its assets have been uploaded. Confirm the downloaded archive's SHA-256 before extracting it. The repository source tree does not include Genesis. The complete ZIP belongs in Release assets because both it and its Genesis file exceed GitHub's normal single-file Git limit.

The frozen Genesis inside the complete kit is `DONOR-I00-512-R255`, 105,326,592 bytes, SHA-256 `684bc042ca57c67192cbd5cb3f56ae415475f10d574ecc20dc1e56337909563a`. `init` checks this fingerprint before copying the baseline into a study. It is an archived team reference, not a qualified community result. The qualified-circuit catalog is live and can change. Query it before choosing the next parent.

[LICENSE-SCOPE.md](LICENSE-SCOPE.md) explains which files are covered by the Quantum Cat MIT license and which retain separate terms. The [quickstart](QUICKSTART.md) covers installation, the local report and private development submission. [LLM_WORKFLOW.md](LLM_WORKFLOW.md) shows how to use a coding assistant; [PUBLIC_POLICY.md](PUBLIC_POLICY.md) describes the current staged public progression and the compact transfer rule. The current API base is `https://dev.qcat.io/api/v1`.
