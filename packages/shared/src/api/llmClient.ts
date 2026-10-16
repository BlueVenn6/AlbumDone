import {
  configSupportsVision,
  COMPAT_MODEL_A_PREFIX,
  COMPAT_MODEL_B_PREFIX,
  COMPAT_PROVIDER_A,
  COMPAT_PROVIDER_B,
  modelSupportsVision,
  proxyModelSupportsVision,
  normalizeProviderModel,
  PROVIDER_MODELS,
  type LLMMessage,
  type LLMResponse,
  type ProviderConfig,
} from '../types';
import {
  buildAnthropicMessagesUrl,
  buildGenerateContentUrl,
  buildOpenAIChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  classifyLLMError,
  createLLMClientError,
  getDefaultProviderBaseUrl,
  LLMClientError,
  normalizeProviderBaseUrl,
  type LLMErrorCategory,
} from './llmEndpoint';
import {
  getHttpUrlHostname,
  parseHttpUrlOrThrow,
} from '../utils/httpUrl';
import {
  GENERATE_CONTENT_API_KEY_HEADER,
  GENERATE_CONTENT_FLASH_MODEL,
  GENERATE_CONTENT_PROVIDER,
} from '../types/generateContentProvider';

export type LLMRequestOptions = {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const SECRET_QUERY_PARAMS = new Set(['key', 'api_key', 'token', 'access_token']);
const COMPAT_MODEL_A_K2_PREFIX = `${COMPAT_MODEL_A_PREFIX}-k2`;
const COMPAT_REASONING_VISION_PATTERN = new RegExp(`(?:thinking|turbo|${COMPAT_MODEL_B_PREFIX}-5v)`, 'i');

function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function getQueryParameterNames(search: string): string[] {
  if (!search.startsWith('?')) {
    return [];
  }

  return search
    .slice(1)
    .split('&')
    .map((entry) => entry.split('=', 1)[0] ?? '')
    .filter(Boolean)
    .map((name) => {
      try {
        return decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        return name;
      }
    });
}

function assertSafeLLMEndpoint(url: string): void {
  const parsedUrl = parseHttpUrlOrThrow(url);
  for (const key of getQueryParameterNames(parsedUrl.search)) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
      throw new Error('LLM endpoint URLs must not include API keys or tokens in query parameters.');
    }
  }
  if (parsedUrl.origin.toLowerCase().startsWith('http://') && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('Plain HTTP LLM endpoints are limited to localhost.');
  }
}

export type TestConnectionResult = {
  success: boolean;
  mode?: 'text' | 'vision';
  error?: string;
  category?: LLMErrorCategory;
  status?: number;
};

export interface LLMTransportResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export type LLMTransport = (
  url: string,
  init: RequestInit,
  timeoutMs: number,
) => Promise<LLMTransportResponse>;

type OpenAIMessage = {
  role: string;
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: string } }
      >;
};

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

type GenerateContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

function anthropicSupportsTemperature(model: string): boolean {
  if (/^claude-(?:mythos|fable)-/.test(model)) return false;
  const version = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(model);
  if (!version) return true;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major < 4 || (major === 4 && minor < 7);
}

function cleanLLMOutput(text: string): string {
  return text
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```(?:[a-z0-9_-]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^'''[\s\S]*?'''\s*/m, '')
    .replace(/^\s+|\s+$/g, '');
}

function isConnectionProbeResponse(text: string, expected = 'ok'): boolean {
  return cleanLLMOutput(text)
    .replace(/[.!。！]+$/g, '')
    .trim()
    .toLowerCase() === expected;
}

const CONNECTION_TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PQQ0AIBDAsLPBG/+20IEIHg3Jkgno5qz9dcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AQF2IQ9lIzkRAAAAAElFTkSuQmCC';


export async function testLLMConnection(
  provider: ProviderConfig['provider'],
  apiKey: string,
): Promise<{ success: boolean; rawResponse?: unknown; error?: string }> {
  const config: ProviderConfig = {
    provider,
    apiKey,
    model: PROVIDER_MODELS[provider].models[0] ?? '',
    supportsVision: modelSupportsVision(provider, PROVIDER_MODELS[provider].models[0] ?? ''),
  };
  const client = new LLMClient(config);

  try {
    const result = await client.chat(
      [{ role: 'user', content: 'Reply with just "ok".' }],
      { maxTokens: 32, temperature: 0 },
    );
    if (!isConnectionProbeResponse(result.content)) {
      return { success: false, error: 'Model returned an unexpected connection-test response.', rawResponse: result };
    }
    return { success: true, rawResponse: result };
  } catch (err) {
    if (err instanceof LLMClientError) {
      return { success: false, error: err.message };
    }
    const classified = classifyLLMError({ error: err, provider, apiKey });
    return { success: false, error: classified.message };
  }
}

export class LLMClient {
  constructor(
    config: ProviderConfig,
    private transport?: LLMTransport,
  ) {
    this.config = {
      ...config,
      model: normalizeProviderModel(config.provider, config.model),
    };
  }

  private config: ProviderConfig;

  private getRequiredApiKey(): string {
    const apiKey = String(this.config.apiKey ?? '').trim();
    if (apiKey) {
      return apiKey;
    }

    if (this.config.hasApiKey) {
      throw new Error(
        'API key is not loaded in the current session. Re-enter it before testing or running AI actions.',
      );
    }

    throw new Error('API key is not configured. Complete setup in Settings first.');
  }

  private supportsVision(): boolean {
    if (configSupportsVision(this.config)) return true;
    if (this.config.mode === 'proxy') {
      return proxyModelSupportsVision(this.config.provider, this.config.model, this.config.baseUrl);
    }

    return modelSupportsVision(
      this.config.provider,
      this.config.model,
      this.config.baseUrl,
    );
  }

  private async compressImageDataUrl(dataUrl: string): Promise<string> {
    const globalScope = globalThis as {
      document?: { createElement?: (tag: string) => any };
      Image?: new () => {
        width: number;
        height: number;
        crossOrigin?: string;
        onload: (() => void) | null;
        onerror: (() => void) | null;
        src: string;
      };
    };
    const documentLike = globalScope.document;
    const ImageCtor = globalScope.Image;

    // Skip if not in browser environment
    if (!documentLike || !ImageCtor) {
      return dataUrl;
    }

    return new Promise((resolve) => {
      const img = new ImageCtor();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const MAX_SIZE = 1024;
        let width = img.width;
        let height = img.height;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          } else {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        const canvas = documentLike.createElement?.('canvas') as
          | {
              width?: number;
              height?: number;
              getContext?: (type: string) => any;
              toDataURL?: (type: string, quality?: number) => string;
            }
          | undefined;
        if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.toDataURL !== 'function') {
          resolve(dataUrl);
          return;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Force JPEG 0.6 compression
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 60000,
  ): Promise<LLMTransportResponse> {
    assertSafeLLMEndpoint(url);

    if (this.transport) {
      try {
        return await this.transport(url, init, timeoutMs);
      } catch (error) {
        if (error instanceof LLMClientError) {
          throw error;
        }
        throw createLLMClientError({
          error,
          mode: this.config.mode,
          provider: this.config.provider,
          apiKey: this.config.apiKey,
        });
      }
    }

    // In Electron renderer, route through main process to bypass CORS restrictions.
    const maybeWindow =
      typeof globalThis !== 'undefined' && 'window' in globalThis
        ? (globalThis as {
            window?: {
              electronAPI?: {
                llm?: {
                  call?: (params: {
                    url: string;
                    method: string;
                    headers: Record<string, string>;
                    body: string;
                  }) => Promise<{ body: string; status: number }>;
                };
              };
            };
          }).window
        : undefined;
    const electronLlm = maybeWindow?.electronAPI?.llm?.call;
    if (electronLlm) {
      const result = await electronLlm({
        url,
        method: init.method ?? 'POST',
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      });
      return new Response(result.body, { status: result.status });
    }

    // Direct fetch path — used on mobile / web where no IPC is available.
    const controller = new AbortController();
    const externalSignal = init.signal;
    let didTimeout = false;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) {
      throw createLLMClientError({
        error: new Error('Request was cancelled by user.'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: this.config.apiKey,
      });
    }
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, Math.max(50, timeoutMs));

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      const wasExternallyAborted = Boolean(externalSignal?.aborted);
      throw createLLMClientError({
        error: didTimeout
          ? new Error('Request timeout.')
          : wasExternallyAborted
            ? new Error('Request was cancelled by user.')
            : err,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: this.config.apiKey,
      });
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  private getBaseUrl(): string {
    return normalizeProviderBaseUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider),
    );
  }

  private isOfficialAnthropicBaseUrl(): boolean {
    if (!this.config.baseUrl) {
      return true;
    }

    return getHttpUrlHostname(this.getBaseUrl()) === 'api.anthropic.com';
  }

  private buildOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as OpenAIMessage[];
  }

  private hasImage(messages: LLMMessage[]): boolean {
    return messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p.type === 'image_url'),
    );
  }

  private shouldUseResponsesApi(): boolean {
    return this.config.mode !== 'proxy'
      && (this.config.provider === 'openai' || this.config.provider === 'custom');
  }

  private async ensureCompressedMessages(messages: LLMMessage[]): Promise<LLMMessage[]> {
    const processed: LLMMessage[] = [];
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        processed.push(msg);
      } else {
        const newContent = await Promise.all(
          msg.content.map(async (part) => {
            if (part.type === 'image_url') {
              const compressed = await this.compressImageDataUrl(part.image_url.url);
              return { ...part, image_url: { ...part.image_url, url: compressed } };
            }
            return part;
          }),
        );
        processed.push({ ...msg, content: newContent });
      }
    }
    return processed;
  }

  private async callOpenAICompatible(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const url = buildOpenAIChatCompletionsUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider),
    );
    let model = this.config.model;
    const isKimiK2 = this.config.provider === COMPAT_PROVIDER_A && model.startsWith(COMPAT_MODEL_A_K2_PREFIX);

    const compressedMessages = await this.ensureCompressedMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: this.buildOpenAIMessages(compressedMessages),
      max_tokens: options.maxTokens ?? 2048,
    };
    const temperature = isKimiK2 ? 1 : options.temperature;
    if (typeof temperature === 'number') {
      body.temperature = temperature;
    }
    if (isKimiK2) body['top_p'] = 0.95;

    const authKey = this.getRequiredApiKey();

    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authKey}`,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.timeoutMs);

    if (!resp.ok) {
      const text = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    const data = (await resp.json()) as any;

    if (!data.choices || data.choices.length === 0) {
      throw createLLMClientError({
        error: new Error('OpenAI-compatible response has no choices'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    const choice = data.choices[0];
    const rawContent = [
      choice.message?.content,
      choice.delta?.content,
      choice.message?.reasoning_content,
      choice.delta?.reasoning_content,
      choice.text,
      data.output_text,
    ].find((value) => (
      Array.isArray(value)
        ? value.length > 0
        : value !== undefined && value !== null && String(value).trim().length > 0
    )) ?? '';
    const contentFromParts = Array.isArray(rawContent)
      ? rawContent.map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text' && typeof part.text === 'string') return part.text;
          if (typeof part?.text === 'string') return part.text;
          return '';
        }).join('')
      : rawContent;
    
    // Force normalization to string
    const content = cleanLLMOutput(
      typeof contentFromParts === 'object' ? JSON.stringify(contentFromParts) : String(contentFromParts),
    );

    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        }
      : undefined;

    return {
      content,
      ...(usage ? { usage } : {}),
    };
  }

  private buildResponsesInput(messages: LLMMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      const content = typeof msg.content === 'string'
        ? [{ type: 'input_text', text: msg.content }]
        : msg.content.map((part) => {
            if (part.type === 'text') {
              return { type: 'input_text', text: part.text };
            }
            return {
              type: 'input_image',
              image_url: part.image_url.url,
              ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
            };
          });
      return {
        role: msg.role,
        content,
      };
    });
  }

  private extractResponsesText(data: any): string {
    if (typeof data?.output_text === 'string') {
      return data.output_text;
    }

    const output = Array.isArray(data?.output) ? data.output : [];
    const parts: string[] = [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (typeof part?.text === 'string') {
          parts.push(part.text);
        } else if (typeof part?.output_text === 'string') {
          parts.push(part.output_text);

        }
      }
    }
    return parts.join('');
  }

  private async callOpenAIResponses(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const url = buildOpenAIResponsesUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider),
    );
    const compressedMessages = await this.ensureCompressedMessages(messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      input: this.buildResponsesInput(compressedMessages),
      max_output_tokens: options.maxTokens ?? 2048,
    };
    if (typeof options.temperature === 'number' && !/^gpt-5(?:\.|-|$)/i.test(this.config.model)) {
      body.temperature = options.temperature;
    }

    const authKey = this.getRequiredApiKey();
    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authKey}`,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.timeoutMs);

    if (!resp.ok) {
      const text = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    const data = (await resp.json()) as any;
    const content = cleanLLMOutput(this.extractResponsesText(data));
    if (!content) {
      throw createLLMClientError({
        error: new Error('Responses API response has no output text'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    const usage = data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
        }
      : undefined;

    return {
      content,
      ...(usage ? { usage } : {}),
    };
  }

  private async callAnthropic(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const url = buildAnthropicMessagesUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider),
    );
    const isOfficialAnthropic = this.isOfficialAnthropicBaseUrl();

    const compressedMessages = await this.ensureCompressedMessages(messages);

    const systemMessages = compressedMessages.filter((m) => m.role === 'system');
    const nonSystemMessages = compressedMessages.filter((m) => m.role !== 'system');
    const systemPrompt =
      systemMessages.length > 0
        ? typeof systemMessages[0]!.content === 'string'
          ? systemMessages[0]!.content
          : ''
        : undefined;

    const anthropicMessages = nonSystemMessages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      const parts: AnthropicContent[] = msg.content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text' as const, text: part.text };
        } else {
          const url = part.image_url.url;
          const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: base64Match[1]!,
                data: base64Match[2]!,
              },
            };
          }
          return { type: 'text' as const, text: `[Image: ${url}]` };
        }
      });
      return { role: msg.role, content: parts };
    });

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 2048,
    };
    if (typeof options.temperature === 'number' && anthropicSupportsTemperature(this.config.model)) {
      body.temperature = options.temperature;
    }
    if (systemPrompt) body['system'] = systemPrompt;

    const authKey = this.getRequiredApiKey();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': authKey,
      'anthropic-version': '2023-06-01',
    };
    if (!isOfficialAnthropic) {
      headers['Authorization'] = `Bearer ${authKey}`;
    }

    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.timeoutMs);

    if (!resp.ok) {
      const text = await resp.text();
      if (!isOfficialAnthropic && [400, 401, 403, 404, 405].includes(resp.status)) {
        return this.callOpenAICompatible(messages, options);
      }
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    const data = (await resp.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textBlock = data.content.find((c) => c.type === 'text');
    if (!textBlock?.text) {
      throw createLLMClientError({
        error: new Error('No text content in Anthropic response'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: authKey,
      });
    }

    // Force normalization to string
    const content = cleanLLMOutput(
      typeof textBlock.text === 'object' ? JSON.stringify(textBlock.text) : String(textBlock.text),
    );

    const usage = data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
        }
      : undefined;

    return {
      content,
      ...(usage ? { usage } : {}),
    };
  }

  private async callGenerateContent(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const model = this.config.model || GENERATE_CONTENT_FLASH_MODEL;

    const apiKey = this.getRequiredApiKey();
    const url = buildGenerateContentUrl(
      this.config.baseUrl,
      model,
      apiKey,
      getDefaultProviderBaseUrl(this.config.provider),
    );

    const compressedMessages = await this.ensureCompressedMessages(messages);

    const contents = compressedMessages
      .filter((m) => m.role !== 'system')
      .map((msg) => {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        if (typeof msg.content === 'string') {
          return { role, parts: [{ text: msg.content }] };
        }
        const parts: GenerateContentPart[] = msg.content.map((part) => {
          if (part.type === 'text') return { text: part.text };
          const url = part.image_url.url;
          const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            return {
              inline_data: {
                mime_type: base64Match[1]!,
                data: base64Match[2]!,
              },
            };
          }
          return { text: `[Image: ${url}]` };
        });
        return { role, parts };
      });

    const systemInstruction = compressedMessages.find((m) => m.role === 'system');
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 2048,
      },
    };
    if (typeof options.temperature === 'number') {
      (body.generationConfig as { temperature?: number }).temperature = options.temperature;
    }

    if (systemInstruction) {
      body['system_instruction'] = {
        parts: [
          {
            text:
              typeof systemInstruction.content === 'string'
                ? systemInstruction.content
                : '',
          },
        ],
      };
    }

    const resp = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [GENERATE_CONTENT_API_KEY_HEADER]: apiKey,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.timeoutMs);

    if (!resp.ok) {
      const text = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey,
      });
    }

    const data = (await resp.json()) as any;

    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
      throw createLLMClientError({
        error: new Error('generateContent response has no candidates'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey,
      });
    }

    const candidate = data.candidates[0];
    const parts = candidate?.content?.parts;
    
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw createLLMClientError({
        error: new Error('generateContent response has no content parts'),
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey,
      });
    }

    const rawText = parts.map((p: any) => p.text || '').join('');
    const text = cleanLLMOutput(
      typeof rawText === 'object' ? JSON.stringify(rawText) : String(rawText),
    );

    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
        }
      : undefined;

    return {
      content: text,
      ...(usage ? { usage } : {}),
    };
  }

  async chat(messages: LLMMessage[], options: LLMRequestOptions = {}): Promise<LLMResponse> {
    if (this.config.mode === 'proxy') {
      return this.callOpenAICompatible(messages, options);
    }
    if (this.shouldUseResponsesApi()) {
      return this.callOpenAIResponses(messages, options);
    }

    switch (this.config.provider) {
      case 'anthropic':
        return this.callAnthropic(messages, options);
      case GENERATE_CONTENT_PROVIDER:
        return this.callGenerateContent(messages, options);
      default:
        return this.callOpenAICompatible(messages, options);
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const isKimiK2 =
      this.config.provider === COMPAT_PROVIDER_A && this.config.model?.startsWith(COMPAT_MODEL_A_K2_PREFIX);
    const isMiniMaxM3 =
      this.config.provider === 'minimax' && this.config.model === 'MiniMax-M3';
    const isReasoningVisionModel = this.config.provider === COMPAT_PROVIDER_B
      && COMPAT_REASONING_VISION_PATTERN.test(this.config.model);
    const maxTokens = isKimiK2 ? 2048 : isMiniMaxM3 || isReasoningVisionModel ? 512 : 32;
    const timeoutMs = this.config.mode === 'proxy' || isMiniMaxM3 ? 60000 : 20000;
    const shouldTestVision = this.supportsVision();
    const expectedReply = shouldTestVision ? 'red' : 'ok';

    try {
      const response = shouldTestVision
        ? await this.chatWithImage(
          'What is the dominant color of this image? Reply with just the English color name.',
          CONNECTION_TEST_IMAGE_BASE64,
          'image/png',
          { maxTokens, temperature: 0, timeoutMs },
        )
        : await this.chat(
          [{ role: 'user', content: 'Reply with just "ok".' }],
          { maxTokens, temperature: 0, timeoutMs },
        );

      if (isConnectionProbeResponse(response.content, expectedReply)) {
        return {
          success: true,
          mode: shouldTestVision ? 'vision' : 'text',
        };
      }
      return {
        success: false,
        mode: shouldTestVision ? 'vision' : 'text',
        error: 'Model returned an unexpected connection-test response.',
        category: response.content ? 'invalid_response' : 'empty_response',
      };
    } catch (err) {
      if (err instanceof LLMClientError) {
        return {
          success: false,
          mode: shouldTestVision ? 'vision' : 'text',
          error: err.message,
          category: err.category,
          ...(err.status ? { status: err.status } : {}),
        };
      }
      const classified = classifyLLMError({
        error: err,
        mode: this.config.mode,
        provider: this.config.provider,
        apiKey: this.config.apiKey,
      });
      return {
        success: false,
        mode: shouldTestVision ? 'vision' : 'text',
        error: classified.message,
        category: classified.category,
        ...(classified.status ? { status: classified.status } : {}),
      };
    }
  }

  async chatWithImage(
    prompt: string,
    imageBase64: string,
    mimeType: string,
    options: LLMRequestOptions = {},
  ): Promise<LLMResponse> {
    if (!this.supportsVision()) {
      throw new Error(`Provider ${this.config.provider} does not support vision`);
    }

    const dataUrl = `data:${mimeType};base64,${imageBase64}`;

    // 1. Anthropic Logic
    if (this.config.provider === 'anthropic' && this.config.mode !== 'proxy') {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            { type: 'text', text: prompt },
          ],
        },
      ];
      return this.callAnthropic(messages, options);
    }

    // 2. generateContent direct protocol
    if (this.config.provider === GENERATE_CONTENT_PROVIDER && this.config.mode !== 'proxy') {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ];
      return this.callGenerateContent(messages, options);
    }

    // 3. Default OpenAI-Compatible Logic
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          { type: 'text', text: prompt },
        ],
      },
    ];
    return this.chat(messages, options);
  }
}
