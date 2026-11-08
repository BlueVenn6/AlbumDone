[English](README.md) | [简体中文](README.zh-CN.md)

# AlbumDone

An offline Windows photo organizer with duplicate review, manual review and a twelve-month photo review. The current desktop version is **0.2.1 without AI features**, licensed under MIT. The public repository history is retained.

## Version 0.2.1

The [release record](CHANGELOG.md) describes the verified changes, exact runtime source commit and installer checksum. This update publishes the desktop source and documentation. A 0.2.1 installer has not been attached to a GitHub Release by this source update; older release downloads belong to their listed versions.

The existing 0.2.1 installer is **unsigned**. Its packaged application passed the recorded functional checks, including fifteen-language layouts and JPG export. Installation over an existing version and upgrades have not been validated. SignPath signing remains a separate release step; see the [Code signing policy](CODE_SIGNING_POLICY.md).

## Workflows

- Duplicate review: choose a quantity, inspect each group, change the photo to keep or keep the whole group. The large image is a preview of one group member. Review selections before confirming deletion. Completed batches return to quantity selection and retain folder progress.
- Manual review: previous/next buttons, keep/delete decisions, undo, keyboard shortcuts, grid and single-photo views. Browsing a photo does not mark it as reviewed. Choose another batch after completing a review.
- Year in Review: past twelve months or last calendar year; select a different candidate within a month, change empty-month quotes, and save the exact current choices as a local JPG.
- Fifteen bundled languages, with a language selector. Local folder selection, thumbnails, checkpoint recovery and the recycle bin remain available.

This version removes provider settings, model requests, API-key handling, screenshot instruction workflows and OCR. Screenshot filename detection remains a local utility for photo selection.

## Development

Windows x64, Node **22.23.4**, npm **12.2.2**, and Git:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test
npm --workspace @photo-manager/desktop run build
npm --workspace @photo-manager/desktop run test:e2e
npm --workspace @photo-manager/desktop run benchmark:reproducible -- 1000
```

The Electron production acceptance test creates synthetic photos and a separate application profile. It does not use your photo library. It requires a Windows desktop session.

```powershell
npm run dev:desktop
```

## Packaging and provenance

Commit the tested source, then run:

```powershell
npm --workspace @photo-manager/desktop run package
```

The packaging script rejects a dirty Git tree, cleans generated output, builds shared/main/renderer code, embeds `build-source.json`, and creates an installer and a SHA-256 build record in `packages/desktop/release`. To run the same acceptance test against the exact packaged application:

```powershell
$env:ALBUMDONE_ACCEPTANCE_EXE = (Resolve-Path packages/desktop/release/win-unpacked/AlbumDone.exe).Path
npm --workspace @photo-manager/desktop run test:e2e
```

A successful source test or build does not establish that an installer has passed runtime acceptance. See the [0.2.1 release record](CHANGELOG.md), [release provenance](RELEASE_SOURCES.md), [privacy](PRIVACY.md), [user guide](docs/USER_GUIDE.md), and [Code signing policy](CODE_SIGNING_POLICY.md).

Mobile builds live in a separate private repository. No Android/iOS signing material belongs in this public repository. License: [MIT](LICENSE).
