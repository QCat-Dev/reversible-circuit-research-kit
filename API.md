# Research interface — kit 0.10.4

Research API base URL: `https://45.197.12.124/api/v1`. For local development, use `http://localhost:3000/api/v1`. The base URL is a prefix, not a standalone page; a public example is [the current submission specification](https://45.197.12.124/api/v1/research/submission-spec). The shared schemas and rules are in `src/protocol.mjs`, `templates/submission.schema.json` and `templates/run-report.schema.json`. `GET /research/submission-spec` returns the current rules to a client. This document describes the implemented research interface, not future public verification or chain operations.

## Authentication and data model

Create an API key in the site's account page. Send `Authorization: Bearer <QCAT_API_KEY>`; never place it in `qcat.project.json`, a ZIP or a URL. Public task and leaderboard reads need no key. Circuit/reference catalog and downloads need `circuits:read`; private history and evidence need `submissions:read`; preflight, upload, submit and verification requests need `submissions:write`. Cookie requests from the website use Origin and CSRF checks instead.

The current task ID is `ecc-point-addition`, task version `ecc-random-v2`. A research submission consists of an immutable manifest and six required artifacts: circuit (`ops.qdelta` when reproducible, otherwise `ops.bin`), `parameters.json`, `method.md`, `research-report.md` or PDF, completed `run-report.json`, and `run.log`. A source ZIP and up to three supporting files are optional for private intake; a reproducible source archive is required before public qualification. The complete starter kit includes Genesis once; the framework ZIP does not.

## Read and prepare

| Method and path | Key | Response or use |
| --- | --- | --- |
| `GET /challenges` | None | Current task and previews. |
| `GET /challenges/ecc-point-addition/versions/ecc-random-v2` | None | `{definition,manifestHash,scientificPackage}`. `manifestHash` is SHA-256 of `JSON.stringify(definition)` in the returned key order. `task-manifest <file>` fetches and checks this. |
| `GET /research/submission-spec` | None | `kitVersion`, artifact rules, JSON Schemas and guide paths. |
| `GET /research/verification` | None | Server precheck readiness, release and protocol hash, 10,048-input policy. |
| `GET /reference-circuits` | `circuits:read` | Archived team references with IDs, evidence and fingerprints. These are separate from publicly qualified community records. |
| `GET /reference-circuits/:id/manifest` | `circuits:read` | One reference, file paths and for Genesis the complete kit version/size/SHA-256. |
| `GET /reference-circuits/:id/complete-kit` | `circuits:read` | One-time Genesis starter ZIP; `X-Content-SHA256` and `Content-Length` must match the manifest. |
| `GET /reference-circuits/:id/file` | `circuits:read` | One archived full circuit when explicitly requested. |

`init <folder>` imports bundled Genesis when present. Use `init <folder> --baseline <path-to-ops.bin>` to start from a previously pulled qualified version; the adjacent `verified-manifest.json` must match the file. `init <folder> --empty` creates a project without any baseline.

## Qualified circuit catalog and small downloads

| Method and path | Key | Response or use |
| --- | --- | --- |
| `GET /challenges/ecc-point-addition/verified-circuits?sort=best&cursor=<uuid>` | `circuits:read` | Up to 20 summaries, `nextCursor`, no circuit bytes. Use `sort=latest` for reverse chronology. |
| `GET /challenges/ecc-point-addition/verified-circuits/best` | `circuits:read` | Best qualified record manifest, or `{status:"empty",item:null}`. |
| `GET /verified-circuits/:id/manifest` | `circuits:read` | Public record, verified full-circuit fingerprint, source fingerprint and `transport`. |
| `GET /verified-circuits/:id/files/delta` | `circuits:read` | `ops.qdelta` only when `transport.encoding` is `qcat-delta-v1`. Maximum 16 MiB. |
| `GET /verified-circuits/:id/files/source` | `circuits:read` | Reproducible `source.zip`. |
| `GET /verified-circuits/:id/files/circuit` | `circuits:read` | Full `ops.bin` for older noncompact records only; compact records reject this route. |

A compact manifest's relevant fields are `circuit:{sha256,sizeBytes}` for the reconstructed file, `transport:{encoding:"qcat-delta-v1",parentCircuitId,parentCircuitSha256,sha256,sizeBytes}` for the bytes on the wire, and `files:{delta,source}`. The CLI verifies each fetched patch, resolves its parent from the complete kit, `QCAT_BASELINE_PATH`, or earlier qualified patches, then checks the reconstructed full circuit against `circuit`. A missing or mismatched parent fails closed. No publicly qualified community circuit exists yet, so these endpoints currently return an empty catalog rather than private precheck results.

## Private submission transaction

The CLI implements the following ordered transaction; it preserves `.qcat-upload-state.json` for safe retries.

| Step | Method and path | Key | Request and result |
| --- | --- | --- | --- |
| 1 | `POST /research/preflight` | `submissions:write` | JSON `{manifest,runtimeReport}`. Checks schema, report bindings and parent identity before upload. Returns the normalized `manifest`, `bundleHash`, `canonicalBytes`, `authorId` and `scientificStatus`. |
| 2 | `POST /research/uploads` | `submissions:write` | Once per file: JSON `{taskVersion,artifactRole,filename,encoding,sizeBytes,sha256}`. Returns `{uploadId,contentPath,expiresAt}`. Circuit encoding is `qcat-delta-v1` for `.qdelta` or `qeccopsz` for `.bin`. |
| 3 | `POST /research/uploads/:uploadId/content` | `submissions:write` | Exact file bytes, `Content-Type: application/octet-stream`, no Content-Encoding. Returns `{uploadId,status:"ready",sha256}` after size, hash and file validation. |
| 4 | `POST /submissions` | `submissions:write` | `Idempotency-Key: <uuid>` and JSON `{submissionFormat:"research-bundle-v1",manifest,uploads:[{filename,uploadId}],acknowledgeDevelopment:true}`; optional owned `previousSubmissionId`. Returns 202 with `{id,status,verification,duplicate,bundleHash}`. |

The manifest is generated by `check <folder>` as `qcat.submission.json`. Its circuit artifact may be a small patch, but `compiledCircuitSha256` and `compiledCircuitSizeBytes` identify the complete circuit that the server must reconstruct. The server checks parent identity and reconstructed bytes before independent execution. A report or a score string alone is not accepted. Files are immutable after submission. Typical limits: 16 MiB patch, 128 MiB full circuit, 256 MiB total package, at most ten artifacts. The other per-role limits and exact field schemas are returned by `/research/submission-spec`.

## Private reads and independent precheck

| Method and path | Key | Response or use |
| --- | --- | --- |
| `GET /me/submissions?cursor=<cursor>` | `submissions:read` | Owner history, up to 20 records and next cursor. |
| `GET /submissions/:id` | `submissions:read` | Owner receipt/status. |
| `GET /submissions/:id/evidence` | `submissions:read` | Frozen bundle, artifacts, events and author/server evidence. `status <id>` uses this. |
| `GET /submissions/:id/manifest` | `submissions:read` | Canonical manifest bytes with SHA-256 header. |
| `GET /submissions/:id/artifacts/:artifactId` | `submissions:read` | One original file. `download <id> <folder>` checks each hash. |
| `GET /submissions/:id/verification` | `submissions:read` | Job, attempts, current result and retry eligibility. |
| `POST /submissions/:id/verification` | `submissions:write` | Body `{}`. Start an eligible check or request an allowed infrastructure retry; 202. It accepts no caller-provided inputs, seed, verifier or score. |
| `GET /submissions/:id/verification/:attemptId/report` | `submissions:read` | Exact server report bytes and SHA-256 header. |
| `GET /submissions/:id/verification/:attemptId/log` | `submissions:read` | Exact server log bytes and SHA-256 header. |
| `GET /challenges/ecc-point-addition/leaderboard?page=<n>` | None | Publicly qualified ranking, five rows per page. Empty until qualification. |

Server precheck executes its own 10,048 random inputs and keeps its context across infrastructure retries. `prechecked` is a private preliminary result; it is not public qualification, public verification work, a chain receipt or a reward. Public work allocation/result APIs are not open in this release.

## Error and retry rules

401 means no valid key; 403 means the key lacks the required scope. 409 covers closed intake, quota or disallowed retries; 410 covers retired intake or expired uploads. Reuse the same `Idempotency-Key` only for the same manifest and uploaded files. If a transfer fails, retry the exact unchanged artifact; if the content changes, create a new immutable package. Verify `X-Content-SHA256`, declared length and reconstructed circuit hash on every download. The CLI does this automatically.
