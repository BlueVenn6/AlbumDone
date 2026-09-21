# Windows release source

Repository: BlueVenn6/AlbumDone. Candidate branch: release/windows-20260921.
Baseline: installed 0.1.2-beta.10, commit d4b5e6ca0781c7f72e50f4fc4068587360a99d55.
Candidate version: 0.1.2-beta.12; Electron 44.4.3; sharp 0.35.4.

Use Node 22.12 or newer and npm ci. The postinstall step explicitly installs Electron 44's runtime. Mobile is maintained in a separate private repository; the old local monorepo master is not this release's source.

Production inputs are packages/desktop/src and packages/shared/src. TypeScript and Vite write packages/desktop/dist. Run npm --workspace @photo-manager/desktop run package from a clean, tested commit. The script rebuilds generated output, embeds dist/build-source.json, creates one NSIS installer under packages/desktop/release and writes build-record.json with source/lockfile identity and installer SHA-256. It rejects dirty or changing source.

Keep protocol.handle('local-file') and the existing production renderer entry dist/renderer/index.html. Test the exact installer or its packaged application with an isolated profile and fixture photos. A successful source test or build is not final artifact acceptance.
