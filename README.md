# AlbumDone

AlbumDone is an open-source, local-first Windows utility for cleaning and organizing local photo libraries.
It combines photo-cleaner, duplicate-photo-finder, and image-culling workflows with screenshot organization and optional AI-assisted understanding.
Built as a privacy-conscious windows-utility, it keeps core processing on the user's computer and leaves deletion decisions under user review.

This repository is the verified Windows desktop source release. Android and iOS are not included because they have not completed independent device acceptance testing.

## System Requirements

- Windows 10 or Windows 11 on an Intel or AMD x64 computer: natively supported.
- Windows 11 on an ARM64 computer: supported through Windows x64 emulation. The current x64 release has been tested on a Microsoft SQ2 device, but it is not an ARM64-native build.
- Windows 10 on ARM64 and 32-bit Windows: not supported by the current x64 release.

The installer filename includes `x64`. A separate ARM64-native installer is not currently published.

## Local-First Behavior

Core organization, duplicate detection, culling, and local archiving workflows are designed to run on the user's device.

This project does not provide a shared cloud backend for user photos. The developer does not receive or store user photos, API keys, or local files through the app's core local workflows.

## AI and Cloud Models

AI features are optional. When AI screenshot understanding, vision models, or cloud model features are enabled, the current screenshot, user instructions, and required content are sent to the model provider or Custom Endpoint selected by the user.

The request destination depends on the configured provider, Base URL, or Custom Endpoint. If you configure a third-party proxy or custom Base URL, make sure you trust that service before sending screenshots or instructions through it.

The developer does not receive or store these model requests or their contents.

## API Keys

Users provide their own API keys for model providers.

On desktop, API keys are stored with system-backed secure storage such as keytar or Electron safeStorage. Desktop LLM and Vision requests are sent by the Electron main process, and the renderer does not read saved plaintext API keys.

Do not paste API keys into issues, screenshots, logs, public discussions, or pull requests.

## Custom Endpoint Risk

Custom Endpoints are chosen and trusted by the user. Request content may be sent to the configured endpoint.

Do not use unknown or untrusted endpoint addresses. Remote HTTP endpoints, unsafe protocols, and URLs containing token or key query parameters are restricted or rejected by the app.

## File Safety

Back up important photos before using batch delete, culling, or large organization workflows.

Delete operations prefer the system trash when available, with an app-managed fallback trash directory when needed. Recovery is not guaranteed in every environment.

AI results are assistance only and may be inaccurate. Review suggestions before deleting or changing files.

## Development

Install dependencies:

```bash
npm install
```

Run shared tests:

```bash
npm --workspace @photo-manager/shared test
```

Run desktop typecheck:

```bash
npm --workspace @photo-manager/desktop run typecheck
```

Run all workspace checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run the desktop app in development:

```bash
npm run dev:desktop
```

Create a clean, traceable Windows installer:

```bash
npm --workspace @photo-manager/desktop run package
```

The packaging command removes generated Desktop/Shared outputs, rebuilds Shared before Desktop, embeds a source fingerprint, and creates one uniquely named NSIS installer.

### Ports And Local Services

The default ports are defined in `packages/shared/src/config/ports.ts` and mirrored in `.env.example`. Electron main process code mirrors the same env names in `packages/desktop/src/main/ports.ts` because its TypeScript build is scoped to the desktop package.

- Desktop renderer dev server: `5173`
- Desktop LAN sharing server: `7842`, with `7843` fallback if occupied
- Desktop local OpenAI-compatible endpoint default: `http://localhost:11434/v1`

OpenAI official configuration defaults to Base URL `https://api.openai.com/v1`, endpoint `/responses`, and model `gpt-5.5`. Users must provide their own API key in Settings.

## License

AlbumDone is released under the [MIT License](LICENSE).

## Code Signing

The Windows code-signing process and its current approval status are documented
in [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md). Public SignPath signing is
pending; unsigned releases must be labeled accordingly and include a SHA-256
checksum.

## User Documentation

- [Bilingual user guide / 中英文使用指南](docs/USER_GUIDE.md)
