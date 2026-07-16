import type { LLMProvider, ProviderMode } from '../types';
import { APP_PORTS } from '../config/ports';
import {
  parseHttpUrlOrThrow,
  trimTrailingSlashes,
  type ParsedHttpUrl,
} from '../utils/httpUrl';

export type LLMErrorCategory =
  | 'cancelled'
  | 'api_key'
  | 'permission'
  | 'base_url'
  | 'model_not_found'
  | 'request_format'
  | 'rate_limited'
  | 'proxy'
  | 'server'
  | 'timeout'
  | 'network'
  | 'empty_response'
  | 'unknown';

export type ClassifiedLLMError = {
  category: LLMErrorCategory;
  message: string;
  status?: number | undefined;
};

export class LLMClientError extends Error {
  category: LLMErrorCategory;
  status?: number | undefined;

  constructor(error: ClassifiedLLMError) {
    super(error.message);
    this.name = 'LLMClientError';
    this.category = error.category;
    this.status = error.status;
  }
}

const DEFAULT_OPENAI_BASE_URLS: Record<LLMProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  minimax: 'https://api.minimaxi.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: `http://localhost:${APP_PORTS.localOpenAICompatible}/v1`,
};

function parseUrlOrThrow(rawUrl: string): ParsedHttpUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Base URL is required.');
  }
  return parseHttpUrlOrThrow(trimmed);
}

function appendPath(url: ParsedHttpUrl, suffix: string): string {
  const base = trimTrailingSlashes(`${url.origin}${url.pathname}`);
  return `${base}${suffix}${url.search}`;
}

export function getDefaultProviderBaseUrl(provider: LLMProvider): string {
  return DEFAULT_OPENAI_BASE_URLS[provider];
}

export function normalizeProviderBaseUrl(
  baseUrl: string | undefined,
  fallbackBaseUrl: string,
): string {
  const source = trimTrailingSlashes(baseUrl?.trim() ? baseUrl : fallbackBaseUrl);
  const url = parseUrlOrThrow(source);
  return trimTrailingSlashes(`${url.origin}${url.pathname}`);
}

export function buildOpenAIChatCompletionsUrl(
  baseUrl: string | undefined,
  fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.openai,
): string {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || '/');

  if (/\/chat\/completions$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }

  if (pathname === '' || pathname === '/') {
    return `${url.origin}/v1/chat/completions${url.search}`;
  }

  return appendPath(url, '/chat/completions');
}

export function buildOpenAIResponsesUrl(
  baseUrl: string | undefined,
  fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.openai,
): string {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || '/');

  if (/\/responses$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }

  if (/\/chat\/completions$/i.test(pathname)) {
    return `${trimTrailingSlashes(`${url.origin}${pathname.replace(/\/chat\/completions$/i, '')}`)}/responses${url.search}`;
  }

  if (pathname === '' || pathname === '/') {
    return `${url.origin}/v1/responses${url.search}`;
  }

  return appendPath(url, '/responses');
}

export function buildAnthropicMessagesUrl(
  baseUrl: string | undefined,
  fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.anthropic,
): string {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || '/');

  if (/\/messages$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }

  if (pathname === '' || pathname === '/') {
    return `${url.origin}/v1/messages${url.search}`;
  }

  return appendPath(url, '/messages');
}

export function buildGoogleGenerateContentUrl(
  baseUrl: string | undefined,
  model: string,
  _apiKey: string,
  fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.google,
): string {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || '/');
  const encodedModel = encodeURIComponent(model);

  if (/\/models\/[^/]+:generateContent$/i.test(pathname)) {
    const existing = trimTrailingSlashes(`${url.origin}${pathname}`);
    return `${existing}${url.search}`;
  }

  const base =
    pathname === '' || pathname === '/'
      ? `${url.origin}/v1beta`
      : trimTrailingSlashes(`${url.origin}${pathname}`);
  return `${base}/models/${encodedModel}:generateContent`;
}

export function sanitizeLLMErrorText(text: string, apiKey?: string): string {
  let sanitized = text;
  if (apiKey?.trim()) {
    sanitized = sanitized.split(apiKey.trim()).join('[redacted]');
  }
  sanitized = sanitized.replace(/([?&](?:token|access_token|api_key|key)=)[^&\s]+/gi, '$1[redacted]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  sanitized = sanitized.replace(/(Authorization["'\s:=]+)(?:Bearer\s+)?[^"',\s}]+/gi, '$1[redacted]');
  sanitized = sanitized.replace(/(x-api-key["'\s:=]+)[^"',\s}]+/gi, '$1[redacted]');
  sanitized = sanitized.replace(/(key=)[^&\s]+/gi, '$1[redacted]');
  sanitized = sanitized.replace(/(api[_-]?key["'\s:=]+)[^"',\s}]+/gi, '$1[redacted]');
  sanitized = sanitized.replace(/[A-Za-z]:\\[^\s"',)]+/g, '[local-path]');
  sanitized = sanitized.replace(/\/(?:Users|home|var|tmp)\/[^\s"',)]+/g, '[local-path]');
  return sanitized;
}

function bodyContains(body: string | undefined, patterns: RegExp[]): boolean {
  const text = body?.toLowerCase() ?? '';
  return patterns.some((pattern) => pattern.test(text));
}

function extractProviderErrorDetail(body: string): string {
  if (!body.trim()) return '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const detail = parsed.error?.message ?? parsed.message;
    return typeof detail === 'string' ? detail.trim().slice(0, 300) : '';
  } catch {
    return body.trim().replace(/\s+/g, ' ').slice(0, 300);
  }
}

export function classifyLLMError({
  status,
  body,
  error,
  mode = 'direct',
  apiKey,
}: {
  status?: number | undefined;
  body?: string | undefined;
  error?: unknown;
  mode?: ProviderMode | undefined;
  apiKey?: string | undefined;
}): ClassifiedLLMError {
  const rawMessage =
    error instanceof Error ? error.message : error == null ? '' : String(error);
  const safeBody = sanitizeLLMErrorText(body ?? '', apiKey).slice(0, 600);
  const safeMessage = sanitizeLLMErrorText(rawMessage, apiKey);
  const text = `${safeMessage}\n${safeBody}`;

  if (/cancelled by (?:the )?user|request was cancelled|task cancelled/i.test(text)) {
    return { category: 'cancelled', message: 'Request was cancelled.', status };
  }

  if (/timeout|abort/i.test(text)) {
    return { category: 'timeout', message: 'Network request timed out. Check the network or proxy service.', status };
  }

  if (/fetch failed|failed to fetch|network request failed|enotfound|econnrefused|dns|certificate/i.test(text)) {
    return { category: 'base_url', message: 'Base URL is not reachable. Check the address, protocol, and proxy service.', status };
  }

  if (status === 401) {
    return { category: 'api_key', message: 'API Key is invalid, expired, or rejected by the provider.', status };
  }

  if (status === 403) {
    return { category: 'permission', message: 'API Key does not have permission for this model or service.', status };
  }

  if (status === 404) {
    const isModelProblem = bodyContains(safeBody, [
      /model[^\n]{0,80}(?:not\s*found|does\s*not\s*exist|unavailable)/,
      /(?:not\s*found|does\s*not\s*exist|unavailable)[^\n]{0,80}model/,
    ]);
    return {
      category: isModelProblem ? 'model_not_found' : 'base_url',
      message: isModelProblem
        ? 'Model is unavailable. Check the model name and account access.'
        : 'Base URL or endpoint path was not found. Check whether /v1 or /responses is duplicated or missing.',
      status,
    };
  }

  if (status === 429) {
    return { category: 'rate_limited', message: 'Request was rate limited. Try again later or check account quota.', status };
  }

  if (status && [400, 405, 415, 422].includes(status)) {
    const isModelProblem = bodyContains(safeBody, [
      /model[^\n]{0,80}(?:not\s*found|does\s*not\s*exist|unavailable)/,
      /(?:not\s*found|does\s*not\s*exist|unavailable)[^\n]{0,80}model/,
      /unsupported\s*model/,
    ]);
    const providerDetail = extractProviderErrorDetail(safeBody);
    return {
      category: isModelProblem ? 'model_not_found' : 'request_format',
      message: isModelProblem
        ? 'Model is unavailable. Check the model name and account access.'
        : providerDetail
          ? `Request format is incompatible: ${providerDetail}`
          : 'Request format is incompatible. Confirm the service supports the provider API.',
      status,
    };
  }

  if (status && [502, 503, 504].includes(status)) {
    return {
      category: mode === 'proxy' ? 'proxy' : 'server',
      message: mode === 'proxy'
        ? 'Proxy service error. Check the proxy status or upstream model service.'
        : 'Model service is temporarily unavailable. Try again later.',
      status,
    };
  }

  if (status && status >= 500) {
    return {
      category: 'server',
      message: 'Model service returned a server error. Try again later.',
      status,
    };
  }

  if (/choices|candidate|content|empty response|no text/i.test(text)) {
    return {
      category: 'empty_response',
      message: 'Model response was empty or incomplete. Check whether the model supports this request format.',
      status,
    };
  }

  return {
    category: 'unknown',
    message: safeMessage || safeBody || 'Model connection failed. Check the configuration and try again.',
    status,
  };
}

export function createLLMClientError(input: Parameters<typeof classifyLLMError>[0]): LLMClientError {
  return new LLMClientError(classifyLLMError(input));
}
