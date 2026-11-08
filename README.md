[English](README.md) | [简体中文](README.zh-CN.md)

# AlbumDone

An offline Windows photo organizer with duplicate review, manual review and a twelve-month photo review. The current desktop source is **0.2.2 without AI features**, licensed under MIT. The public repository history is retained.

## Version 0.2.2

The [release record](CHANGELOG.md) records security maintenance in 0.2.2 and the previous 0.2.1 artifact's identity and acceptance. No new GitHub Release or signed installer is published by this source update; older release downloads belong to their listed versions.

The 0.2.2 installer is **unsigned**. Its exact packaged application passed eight recorded scenario groups, including fifteen-language layouts, JPG export and synthetic-photo deletion. The release record identifies its source and SHA-256. System installation, overwriting an existing version and upgrades have not been validated. SignPath signing remains a separate release step; see the [Code signing policy](CODE_SIGNING_POLICY.md).

The 0.2.2 lockfile's full dependency audit reports zero affected entries on 2026-11-08 UTC, including checks of Electron and build tools. Local lint, typecheck and unit/integration tests passed; GitHub's runtime-source rescan reported zero open Dependabot and CodeQL alerts. Scope and provenance are recorded in the [release record](CHANGELOG.md); these results are not a guarantee against all vulnerabilities.

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
