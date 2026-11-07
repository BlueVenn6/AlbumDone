# Release source of truth

The active desktop repository has its own `.git` directory and uses only `packages/desktop` and `packages/shared`.

Source → shared TypeScript output → Electron main/preload TypeScript output + Vite production renderer → electron-builder `app.asar` → NSIS installer → installed `AlbumDone.exe`.

The application main entry is `packages/desktop/dist/main/index.js`; the production renderer is `dist/renderer/index.html`. Photo URLs use `protocol.handle('local-file')` and `pathToLocalFileUri`. The retired screenshot/AI/OCR source and old worktrees are outside this repository; Git history preserves prior public releases.

`npm --workspace @photo-manager/desktop run package` requires clean committed source and records commit, source hashes, lockfile hash, time and artifact SHA-256. The manifest is embedded as `dist/build-source.json` and written beside the installer as `build-record.json`. Validate those identities and run `test:e2e` against the packaged executable before claiming runtime acceptance.

Mobile build37 is frozen in a different independent repository. It is not rebuilt or changed by desktop commands.

The release toolchain is Node.js 22.23.4 and npm 12.2.2. Use the pinned npm version before `npm ci`; older npm resolvers do not consistently apply security overrides to workspace dependencies.
