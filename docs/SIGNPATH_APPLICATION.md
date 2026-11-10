# Code-signing application notes

This maintainer guide describes the planned signing setup; it is not an announcement of an approved or signed release.

AlbumDone is developed by Link Vector Pty Ltd. The desktop 0.2.2 source provides three local photo workflows: duplicate review, manual review and Year in Review JPG export. The current version does not include AI-provider integrations or OCR. See the [release record](../CHANGELOG.md) for the unsigned artifact and validation scope.

Public project information:

- Source repository: https://github.com/BlueVenn6/AlbumDone
- Product website: https://linkvectorapp.com/albumdone
- Support: https://linkvectorapp.com/albumdone-support
- Contact: info@linkvectorapp.com
- Privacy policy: [PRIVACY.md](../PRIVACY.md)

The repository includes SignPath artifact configurations and a signing workflow as preparation. Their end-to-end operation has not been validated. Signing requires an approved SignPath project and the repository configuration listed in the [signing policy](../CODE_SIGNING_POLICY.md). Building locally does not establish that this setup is complete.

The signing workflow needs to preserve [source provenance](../RELEASE_SOURCES.md), enforce the required product metadata restrictions, and verify signatures on the exact distributed installer and installed executable. The download page should identify the actual available version and signing status. The SignPath credit shown in the policy is for use after approval; it is not evidence of approval today.
