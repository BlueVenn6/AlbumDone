# SignPath Foundation Application Draft

Use this document when completing the application at <https://signpath.org/apply>.
The repository owner must review the answers, accept the terms, and submit the
application personally.

## Project

- **Project name:** AlbumDone
- **Repository:** https://github.com/BlueVenn6/AlbumDone
- **License:** MIT
- **Project website:** https://github.com/BlueVenn6/AlbumDone
- **Maintainer:** BlueVenn6
- **Release platform:** Windows x64
- **Artifact type:** Electron application distributed as an NSIS installer

## Short Description

AlbumDone is a local-first desktop photo organization tool for reviewing
duplicates, manually culling photos, organizing screenshots, and creating
year-in-review collages, with optional user-configured AI assistance.

## Longer Project Description

AlbumDone helps users organize photo libraries on their own Windows computer.
Its core scanning, duplicate review, culling, screenshot organization, and
local archiving workflows run on the user's device. Optional AI-assisted
screenshot understanding is disabled until the user configures a provider and
supplies their own API key. The application does not operate a developer-owned
service that receives user photos or API keys.

The project is published under the MIT License. Source code, build scripts, and
the GitHub Actions release workflow are public in the project repository.

## Privacy Statement

AlbumDone does not transfer information to networked systems unless the user
explicitly configures and invokes an AI provider or Custom Endpoint. For such
requests, the selected image and instruction are sent directly to the provider
chosen by the user. The developer does not receive or store those requests,
photos, or API keys. See the repository README, SECURITY.md, and DISCLAIMER.md
for the complete user-facing disclosures.

## Build And Release Process

Windows release artifacts are built from the public GitHub repository by a
GitHub-hosted Windows runner. The workflow installs locked npm dependencies,
builds the shared package and desktop application, creates an unpacked Electron
application, submits the application executable to SignPath, builds the NSIS
installer from the signed application directory, submits the installer to
SignPath, verifies both Authenticode signatures, and publishes checksums.

The intended signing chain is:

1. Public source commit and lockfile.
2. GitHub-hosted Windows build.
3. Sign `win-unpacked/AlbumDone.exe` using the application artifact
   configuration.
4. Build the NSIS installer from that signed application directory.
5. Sign the final NSIS installer using the installer artifact configuration.
6. Verify both signatures and publish the signed installer and SHA-256 file.

Unsigned third-party runtime and native dependency binaries are not presented
as project-owned binaries. The project signs its generated application
executable and installer.

## Security And Maintenance

- GitHub multi-factor authentication must be enabled for maintainers.
- Signing is performed only from GitHub-hosted runners.
- The SignPath API token is stored only as a GitHub Actions secret.
- Signing identifiers are stored as GitHub Actions variables.
- Pull requests and security reports are handled through the public repository.
- The project does not include malware, unwanted software, hacking tools, or
  proprietary project components.

## Application Checklist For Repository Owner

- [ ] Review this draft for accuracy.
- [ ] Enable two-factor authentication on GitHub.
- [ ] Publish at least one unsigned GitHub pre-release in the same NSIS format.
- [ ] Confirm the release page documents the application's functionality.
- [ ] Open <https://signpath.org/apply> while signed into the maintainer email.
- [ ] Submit the application and accept SignPath Foundation's terms.
- [ ] Complete any email or identity verification requested by SignPath.
- [ ] After approval, install the SignPath GitHub App for this repository.
- [ ] Create the SignPath API token and GitHub repository variables listed in
      `CODE_SIGNING_POLICY.md`.

