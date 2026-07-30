# Code Signing Policy

AlbumDone's Windows release workflow is designed to build public source on a
GitHub-hosted runner and submit release artifacts to SignPath for Authenticode
signing.

## Current Status

Public code signing is pending approval by SignPath Foundation. Until approval
is complete, releases must be identified as unsigned and accompanied by a
SHA-256 checksum. A release must not claim to be SignPath-signed unless both the
installed `AlbumDone.exe` and the distributed installer have valid
Authenticode signatures.

After approval, the release page and this policy will include the required
credit:

> Free code signing provided by [SignPath.io](https://signpath.io/), certificate
> by [SignPath Foundation](https://signpath.org/).

## Roles

- **Committer, reviewer, and approver:**
  [BlueVenn6](https://github.com/BlueVenn6)

## Privacy

AlbumDone does not transfer information to networked systems unless the user
explicitly configures and invokes an AI provider or Custom Endpoint. The
developer does not receive or store user photos, API keys, or model requests.
See [README.md](README.md), [SECURITY.md](SECURITY.md), and
[DISCLAIMER.md](DISCLAIMER.md) for details.

## Trusted Build

The release workflow is `.github/workflows/windows-signpath-release.yml`. It
must run on a GitHub-hosted Windows runner and signs in two stages:

1. Sign the generated application executable before installer creation.
2. Build the NSIS installer from the signed application and sign the installer.

The workflow verifies both signatures before calculating the final checksum.
Signing changes the artifact bytes, so checksums generated before signing are
never published as final release checksums.

The version-controlled SignPath artifact configurations are:

- `.signpath/artifact-configurations/windows-application.xml`
- `.signpath/artifact-configurations/windows-installer.xml`

The workflow also installs the final signed NSIS artifact into the ephemeral
GitHub runner and verifies the Authenticode signature on the installed
`AlbumDone.exe`.

## Required GitHub Configuration

After SignPath approves the project, configure these repository values:

### Secret

- `SIGNPATH_API_TOKEN`

### Variables

- `SIGNPATH_ENABLED` set to `true` only after approval and setup are complete
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG`

The API token, certificates, and private keys must never be committed to this
repository.
