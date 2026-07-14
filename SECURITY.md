# Security Policy

## Supported Scope

This security policy currently covers:

- Desktop API key storage and request handling.
- LLM and Vision requests.
- Custom Endpoint validation.
- Local file handling for photo organization and deletion workflows.
- Secret leakage risks before publishing the repository.

Mobile features are still being tested and may need a separate security review before release.

## Reporting a Vulnerability

If you find a security issue, do not open a public issue with exploit details.

Do not paste API keys, Bearer tokens, Apple `.p8` keys, keystores, customer photos, private photos, local file paths, logs with secrets, or private project files into public issues, pull requests, screenshots, or discussions.

Please contact the maintainer through the preferred private channel before public disclosure. If a dedicated security contact is added later, use that channel.

## Secrets Not Allowed in Repository

The following files and directories must not be committed:

- `.env`
- `.env.*`
- `*.p8`
- `*.p12`
- `*.mobileprovision`
- `*.jks`
- `*.keystore`
- `private/`
- `secrets.json`
- `config.local.json`
- `settings.local.json`
- `logs/`
- `crash-reports/`

Use example files such as `.env.example` for non-secret templates.

## API Key Handling

Desktop saved plaintext API keys must not be returned to the renderer.

Desktop LLM and Vision requests should be sent by the Electron main process. The main process reads API keys from secure storage only when needed for a request and should not cache them in long-lived global state.

Logs and user-facing errors must redact:

- `Authorization`
- `Bearer`
- `token`
- `access_token`
- `api_key`
- `key`
- `x-api-key`

Provider error responses should be summarized and sanitized before being returned to the UI.

## Custom Endpoint Rules

Custom Endpoint validation should follow these rules:

- Allow HTTPS by default.
- Allow localhost HTTP by default.
- Block remote HTTP by default.
- Block dangerous protocols such as `file://`, `javascript:`, and `data:`.
- Block URLs that include key or token query parameters, including `key`, `api_key`, `token`, and `access_token`.

Users are responsible for trusting any Custom Endpoint they configure.
