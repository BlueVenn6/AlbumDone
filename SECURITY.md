# Security policy

The supported desktop scope includes local file access, Electron main/preload/renderer boundaries, the local-file protocol, task checkpoints, thumbnails, exports and deletion. The no-AI desktop release has no model-provider credentials or remote model requests.

Report security issues privately to [info@linkvectorapp.com](mailto:info@linkvectorapp.com). Include the affected version, reproduction steps and the potential impact. Do not include private photos, personal paths, logs containing secrets, signing keys or keystores in public issues.

The renderer does not have Node integration. High-risk IPC calls validate the sender and the chosen folder. Local photos use `protocol.handle('local-file')` with allowed roots. Permanent deletion requires a separate native confirmation. Contributions affecting these paths should check root validation, symlinks, interrupted operations and build provenance. Keep signing materials, private configuration and sensitive logs out of Git.

See [PRIVACY.md](PRIVACY.md), [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) and [RELEASE_SOURCES.md](RELEASE_SOURCES.md).

## 0.2.2 dependency status

The 2026-11-08 UTC full npm audit of the repaired 0.2.2 lockfile reports zero
affected entries. Electron is pinned to 44.10.2. CI and the signing quality gate
audit all dependencies, including development dependencies that provide the
shipped runtime or build tools. Continue monitoring new advisories; zero known
findings is not a guarantee that the application has no vulnerabilities.

Acceptance helpers send selectors and translated values as serialized CDP
arguments. They do not interpolate those values into executable JavaScript.
Local regression checks passed; exact artifact acceptance and GitHub rescan
results are recorded in [the release record](CHANGELOG.md).

## Historical 0.2.1 dependency status

The 2026-11-08 UTC full npm audit reports 18 affected dependency entries,
including the bundled Electron runtime. The production-only audit omits
Electron because it is declared as a development dependency. The zero findings
in that subset do not clear the installed application's runtime. Dependency
remediation was therefore required before a signed general release. The 0.2.2
source changes do not modify the old 0.2.1 installer. See [the release
record](CHANGELOG.md) for counts and scope.
