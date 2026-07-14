# AlbumDone

AlbumDone is a local-first photo organization tool for desktop, with mobile work in progress. It focuses on photo cleanup, duplicate review, screenshot organization, and optional AI-assisted screenshot understanding.

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

Run mobile typecheck:

```bash
npm --workspace @photo-manager/mobile run typecheck
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

Run the mobile web build locally:

```bash
npm run dev:mobile
npm --workspace @photo-manager/mobile run web:build
```

### Ports And Local Services

The default ports are defined in `packages/shared/src/config/ports.ts` and mirrored in `.env.example`. Electron main process code mirrors the same env names in `packages/desktop/src/main/ports.ts` because its TypeScript build is scoped to the desktop package.

- Desktop renderer dev server: `5173`
- Mobile web dev server: `5183`
- Mobile web preview server: `5184`
- Desktop LAN sharing server: `7842`, with `7843` fallback if occupied
- Desktop local OpenAI-compatible endpoint default: `http://localhost:11434/v1`

OpenAI official configuration defaults to Base URL `https://api.openai.com/v1`, endpoint `/responses`, and model `gpt-5.5`. Users must provide their own API key in Settings.

Mobile builds accept cloud HTTPS model endpoints only. Desktop Custom Endpoint configuration remains user-controlled.

## License

AlbumDone is released under the [MIT License](LICENSE).
