# Release source of truth

The active desktop repository has its own `.git` directory and uses only `packages/desktop` and `packages/shared`.

Source → shared TypeScript output → Electron main/preload TypeScript output + Vite production renderer → electron-builder `app.asar` → NSIS installer → installed `AlbumDone.exe`.

The application main entry is `packages/desktop/dist/main/index.js`; the production renderer is `dist/renderer/index.html`. Photo URLs use `protocol.handle('local-file')` and `pathToLocalFileUri`. The retired screenshot/AI/OCR source and old worktrees are outside this repository; Git history preserves prior public releases.

`npm --workspace @photo-manager/desktop run package` requires clean committed source and records commit, source hashes, lockfile hash, time and artifact SHA-256. The manifest is embedded as `dist/build-source.json` and written beside the installer as `build-record.json`. Validate those identities and run `test:e2e` against the packaged executable before claiming runtime acceptance.

Mobile build37 is frozen in a different independent repository. It is not rebuilt or changed by desktop commands.

The release toolchain is Node.js 22.23.4 and npm 12.2.2. Use the pinned npm version before `npm ci`; older npm resolvers do not consistently apply security overrides to workspace dependencies.

## 0.2.1 source publication

The existing unsigned 0.2.1 artifact was built from commit
`e493d1a6b226a326216cb44849e7ff1a8618b900`. The source-publication updates change
Markdown documentation only; they do not rebuild or rename that artifact.
Its embedded source identity remains the original build commit.
See [the release record](CHANGELOG.md) for the installer identity, verified
behavior and unverified installation/signing steps. Any future signed build
must receive its own source record and final, post-signing checksum.

## 0.2.2 security build

Runtime source commit: `e154eb719a5d424fe36ffe8acec4217bfd61e146`.
Build ID: `20261108T055749Z-e154eb71`. The exact unsigned installer is
`AlbumDone-0.2.2-20261108T055749Z-e154eb71-x64.exe`, SHA-256
`CF87999009DC01D067145159E5D0658B1BC4470006D2BA35AE0ACB78162338D1`.

The post-build source update changes documentation and one acceptance-test
selector. That script is outside the packaged application. Runtime source,
lockfile, desktop package/build configuration and installer bytes remain those
of the recorded runtime commit. Do not rebuild just to change this provenance
documentation. Packaged-runtime acceptance passed against the extracted exact
installer; system installation and upgrade acceptance remain outstanding.
