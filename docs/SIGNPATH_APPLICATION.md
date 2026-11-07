# Code-signing application notes

The desktop 0.2.0 branch contains three offline photo workflows: duplicate review, manual review and year-in-review JPG export. AI providers, cloud model interfaces, screenshot instructions and OCR have been removed.

Retain the existing SignPath artifact configurations and signing workflow. Public signing requires the maintainer’s approved SignPath project, repository variables and secret; their presence is not implied by local packaging. A release may claim a valid signature only after the exact installer and installed executable are checked.

See [signing policy](../CODE_SIGNING_POLICY.md), [privacy](../PRIVACY.md), and [source provenance](../RELEASE_SOURCES.md). Do not commit signing credentials or submit a signing application automatically.
