# Security policy

The supported desktop scope includes local file access, Electron main/preload/renderer boundaries, the local-file protocol, task checkpoints, thumbnails, exports and deletion. The no-AI desktop release has no model-provider credentials or remote model requests.

Report security issues privately to the repository maintainer before public disclosure. Do not include private photos, personal paths, logs containing secrets, signing keys or keystores in public issues. Keep local signing materials, environment files, private configuration, logs and generated output out of Git.

The renderer does not have Node integration. High-risk IPC calls validate the sender and the chosen folder. Local photos use protocol.handle('local-file') with allowed roots. Permanent deletion requires a separate native confirmation. Continue checking root validation, symlinks, interrupted operations and provenance when changing these paths.

See [PRIVACY.md](PRIVACY.md), [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) and [RELEASE_SOURCES.md](RELEASE_SOURCES.md). Mobile signing and privacy declarations are managed in the separate private mobile repository.
