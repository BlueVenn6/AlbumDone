# Code Signing Policy

AlbumDone's Windows release workflow is designed to build public source on a
GitHub-hosted runner and submit release artifacts to SignPath for Authenticode
signing.

## Current Status

The existing 0.2.1 installer is unsigned. SignPath approval, repository
configuration and a successful signed release have not been verified for this
version. Until signing is complete, releases must be identified as unsigned and
accompanied by a SHA-256 checksum. A release must not claim to be SignPath-signed unless both the
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

Photo workflows run locally. This release removes AI-provider, model-request and API-key integrations. See [PRIVACY.md](PRIVACY.md) for local storage and network behavior.

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

These are the intended workflow checks, not evidence that a signed release has
already passed. Before this workflow is used for production, it must preserve
the source manifest and build record described in [release provenance](RELEASE_SOURCES.md),
enforce SignPath's required product metadata restrictions, and pass end-to-end
validation against the exact signed installer. See the [0.2.1 release record](CHANGELOG.md)
for the scope of the existing unsigned artifact's acceptance.

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
