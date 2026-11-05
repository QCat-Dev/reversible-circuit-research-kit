# Research kit downloads and integrity

Version **0.10.4** has two archives:

| Archive | Contents | Starting point |
| --- | --- | --- |
| `qcat-research-kit-complete-v0.10.4.zip` | Client, schemas, editable study template, verifier source and frozen Genesis | Optional one-time starter |
| `qcat-research-kit-framework-v0.10.4.zip` | Same framework without Genesis | Use `pull-genesis` with a `circuits:read` API key or import an authorized baseline |

The account-protected [Genesis card](https://45.197.12.124/research/circuits) serves the complete starter. A repository clone can use `pull-genesis` to fetch the same frozen baseline with an API key. The versioned GitHub Release also provides both archives and `SHA256SUMS.txt` when its assets have been uploaded. Confirm the downloaded archive's SHA-256 before extracting it. The repository source tree does not include Genesis. The complete ZIP belongs in Release assets because both it and its Genesis file exceed GitHub's normal single-file Git limit.

The frozen Genesis inside the complete kit is `DONOR-I00-512-R255`, 105,326,592 bytes, SHA-256 `684bc042ca57c67192cbd5cb3f56ae415475f10d574ecc20dc1e56337909563a`. `init` checks this fingerprint before copying the baseline into a study. It is an archived team reference, not a qualified community result. The public qualified-circuit catalog is currently empty.

[LICENSE-SCOPE.md](LICENSE-SCOPE.md) explains which files are covered by the Quantum Cat MIT license and which retain separate terms. The [quickstart](QUICKSTART.md) covers installation, the local report and private development submission. [LLM_WORKFLOW.md](LLM_WORKFLOW.md) shows how to use a coding assistant; [PUBLIC_POLICY.md](PUBLIC_POLICY.md) separates future public admission rules from current private intake. The current API base is `https://45.197.12.124/api/v1`.
