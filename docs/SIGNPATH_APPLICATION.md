# Code-signing application notes

The desktop 0.2.1 source contains three offline photo workflows: duplicate review, manual review and year-in-review JPG export. AI providers, cloud model interfaces, screenshot instructions and OCR have been removed. See the [0.2.1 release record](../CHANGELOG.md) for the existing unsigned artifact and acceptance scope.

The repository includes SignPath artifact configurations and a signing workflow as preparation. Their end-to-end operation has not been validated for 0.2.1. Public signing requires the maintainer’s approved SignPath project, repository variables and secret; their presence is not implied by local packaging. Source provenance and the required product metadata restrictions must be carried through the signing workflow. A release may claim a valid signature only after the exact installer and installed executable are checked.

See [signing policy](../CODE_SIGNING_POLICY.md), [privacy](../PRIVACY.md), and [source provenance](../RELEASE_SOURCES.md). Do not commit signing credentials or submit a signing application automatically.
