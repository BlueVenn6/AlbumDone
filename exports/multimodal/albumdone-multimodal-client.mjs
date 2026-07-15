// packages/shared/src/utils/httpUrl.ts
var HTTP_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?(?:#.*)?$/i;
function trimTrailingSlashes(value) {
  return value.trim().replace(/\/+$/, "");
}
function getHostnameFromAuthority(authority) {
  const withoutCredentials = authority.split("@").pop() ?? authority;
  if (withoutCredentials.startsWith("[")) {
    const endIndex = withoutCredentials.indexOf("]");
    return endIndex >= 0 ? withoutCredentials.slice(1, endIndex).toLowerCase() : withoutCredentials.toLowerCase();
  }
  return withoutCredentials.split(":")[0]?.toLowerCase() ?? "";
}
function parseHttpUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(HTTP_URL_PATTERN);
  if (!match) {
    return null;
  }
  const protocol = match[1]?.toLowerCase();
  const authority = match[2];
  if (!protocol || !authority || !["http", "https"].includes(protocol)) {
    return null;
  }
  const hostname = getHostnameFromAuthority(authority);
  if (!hostname) {
    return null;
  }
  return {
    origin: `${protocol}://${authority}`,
    pathname: match[3] || "/",
    search: match[4] || "",
    hostname
  };
}
function parseHttpUrlOrThrow(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    throw new Error("Base URL is invalid. Enter a full URL, for example https://api.example.com/v1.");
  }
  return parsed;
}
function getHttpUrlHostname(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  return parseHttpUrl(rawUrl)?.hostname ?? null;
}

// packages/shared/src/types/llm.ts
var PROVIDER_MODELS = {
  openai: {
    name: "OpenAI",
    models: ["gpt-5.5", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    supportsVision: true
  },
  anthropic: {
    name: "Anthropic",
    models: [
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5"
    ],
    supportsVision: true
  },
  google: {
    name: "Google",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-flash-image",
      "gemini-2.5-flash",
      "gemini-2.5-pro"
    ],
    supportsVision: true
  },
  moonshot: {
    name: "Moonshot (Kimi)",
    models: [
      "kimi-k2.5"
    ],
    supportsVision: true
  },
  zhipu: {
    name: "Zhipu AI (GLM)",
    models: [
      "glm-5v-turbo",
      "glm-4.6v",
      "glm-4.6v-flash",
      "glm-4.5v",
      "glm-4.1v-thinking-flash",
      "glm-4v-plus",
      "glm-4v"
    ],
    supportsVision: true
  },
  qwen: {
    name: "Alibaba (Qwen)",
    models: [
      "qwen3.7-plus",
      "qwen3.6-flash",
      "qwen3.5-plus",
      "qwen3.5-flash",
      "qwen3.5-omni-plus",
      "qwen3-vl-plus",
      "qwen3-vl-flash",
      "qwen-vl-max",
      "qwen-vl-plus"
    ],
    supportsVision: true
  },
  minimax: {
    name: "MiniMax",
    models: ["MiniMax-VL-01"],
    supportsVision: true
  },
  deepseek: {
    name: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    supportsVision: false
  },
  custom: {
    name: "Custom Endpoint",
    models: [],
    supportsVision: true
  }
};
var VISION_MODELS = {
  openai: PROVIDER_MODELS.openai.models,
  anthropic: PROVIDER_MODELS.anthropic.models,
  google: PROVIDER_MODELS.google.models,
  moonshot: PROVIDER_MODELS.moonshot.models,
  zhipu: PROVIDER_MODELS.zhipu.models,
  qwen: PROVIDER_MODELS.qwen.models,
  minimax: PROVIDER_MODELS.minimax.models,
  deepseek: []
};
var NON_VISION_MODEL_PATTERN = /(reasoner|embedding|rerank|audio|tts|whisper)/i;
var VISION_MODEL_PATTERN = /(vision|vl|4o|gpt-4|gpt-5|claude|gemini|kimi|glm|qwen|minimax|llava)/i;
function getHostname(baseUrl) {
  return getHttpUrlHostname(baseUrl);
}
function providerHasVisionModels(provider) {
  if (provider === "custom") return true;
  return (VISION_MODELS[provider]?.length ?? 0) > 0;
}
function modelSupportsVision(provider, model, baseUrl) {
  if (provider === "custom") {
    const normalizedModel2 = model.toLowerCase();
    if (NON_VISION_MODEL_PATTERN.test(normalizedModel2)) {
      return false;
    }
    return VISION_MODEL_PATTERN.test(normalizedModel2);
  }
  if (provider === "anthropic") {
    const hostname = getHostname(baseUrl);
    if (hostname && hostname !== "api.anthropic.com") {
      return false;
    }
  }
  const visionModels = VISION_MODELS[provider];
  if (!visionModels) {
    return PROVIDER_MODELS[provider].supportsVision;
  }
  if (visionModels.includes(model)) {
    return true;
  }
  if (!PROVIDER_MODELS[provider].supportsVision) {
    return false;
  }
  const normalizedModel = model.toLowerCase();
  if (NON_VISION_MODEL_PATTERN.test(normalizedModel)) {
    return false;
  }
  return VISION_MODEL_PATTERN.test(normalizedModel);
}
function proxyModelSupportsVision(provider, model, baseUrl) {
  const normalizedModel = model.toLowerCase();
  if (NON_VISION_MODEL_PATTERN.test(normalizedModel)) {
    return false;
  }
  if (VISION_MODELS[provider]?.includes(model)) {
    return true;
  }
  return VISION_MODEL_PATTERN.test(normalizedModel);
}
function configSupportsVision(config) {
  if (!config) return false;
  if (config.mode === "proxy") {
    return proxyModelSupportsVision(config.provider, config.model, config.baseUrl);
  }
  return modelSupportsVision(config.provider, config.model, config.baseUrl);
}
function hasConfiguredApiKey(config) {
  return Boolean(config?.apiKey?.trim() || config?.hasApiKey);
}
function getConfiguredProviders(providers, options = {}) {
  const requiresVision = options.requiresVision ?? false;
  const allowMissingApiKey = options.allowMissingApiKey ?? false;
  return Object.entries(providers).flatMap(([provider, config]) => {
    if (!config || !allowMissingApiKey && !hasConfiguredApiKey(config)) {
      return [];
    }
    if (requiresVision && !configSupportsVision(config)) {
      return [];
    }
    return [provider];
  });
}
function resolveProviderRoute(providers, defaults = {}, options = {}) {
  const requiresVision = options.requiresVision ?? false;
  const allowMissingApiKey = options.allowMissingApiKey ?? false;
  const candidates = [
    [defaults.providerKey, "selected"],
    [defaults.defaultVisionProvider, "defaultVision"],
    [defaults.defaultTextProvider, "defaultText"]
  ];
  for (const [provider, source] of candidates) {
    if (!provider) {
      continue;
    }
    const config2 = providers[provider];
    if (!config2 || !allowMissingApiKey && !hasConfiguredApiKey(config2)) {
      continue;
    }
    if (requiresVision && !configSupportsVision(config2)) {
      continue;
    }
    return { provider, config: config2, source };
  }
  const fallbackProvider = getConfiguredProviders(providers, { requiresVision, allowMissingApiKey })[0];
  if (!fallbackProvider) {
    return null;
  }
  const config = providers[fallbackProvider];
  if (!config) {
    return null;
  }
  return {
    provider: fallbackProvider,
    config,
    source: "firstConfigured"
  };
}
function formatProviderRouteLabel(route) {
  return `${PROVIDER_MODELS[route.provider].name} \xB7 ${route.config.model}`;
}

// packages/shared/src/config/ports.ts
function readEnvNumber(key, fallback) {
  const maybeProcess = globalThis;
  const value = maybeProcess.process?.env?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
var APP_PORTS = {
  desktopRenderer: readEnvNumber("ALBUMDONE_DESKTOP_RENDERER_PORT", 5173),
  mobileWeb: readEnvNumber("ALBUMDONE_MOBILE_WEB_PORT", 5183),
  mobileWebPreview: readEnvNumber("ALBUMDONE_MOBILE_WEB_PREVIEW_PORT", 5184),
  lanServer: readEnvNumber("ALBUMDONE_LAN_SERVER_PORT", 7842),
  localOpenAICompatible: readEnvNumber("ALBUMDONE_LOCAL_OPENAI_COMPATIBLE_PORT", 11434)
};

// packages/shared/src/api/llmEndpoint.ts
var LLMClientError = class extends Error {
  category;
  status;
  constructor(error) {
    super(error.message);
    this.name = "LLMClientError";
    this.category = error.category;
    this.status = error.status;
  }
};
var DEFAULT_OPENAI_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  minimax: "https://api.minimax.chat/v1",
  deepseek: "https://api.deepseek.com/v1",
  custom: `http://localhost:${APP_PORTS.localOpenAICompatible}/v1`
};
function parseUrlOrThrow(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Base URL is required.");
  }
  return parseHttpUrlOrThrow(trimmed);
}
function appendPath(url, suffix) {
  const base = trimTrailingSlashes(`${url.origin}${url.pathname}`);
  return `${base}${suffix}${url.search}`;
}
function getDefaultProviderBaseUrl(provider) {
  return DEFAULT_OPENAI_BASE_URLS[provider];
}
function normalizeProviderBaseUrl(baseUrl, fallbackBaseUrl) {
  const source = trimTrailingSlashes(baseUrl?.trim() ? baseUrl : fallbackBaseUrl);
  const url = parseUrlOrThrow(source);
  return trimTrailingSlashes(`${url.origin}${url.pathname}`);
}
function buildOpenAIChatCompletionsUrl(baseUrl, fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.openai) {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || "/");
  if (/\/chat\/completions$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }
  if (pathname === "" || pathname === "/") {
    return `${url.origin}/v1/chat/completions${url.search}`;
  }
  return appendPath(url, "/chat/completions");
}
function buildOpenAIResponsesUrl(baseUrl, fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.openai) {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || "/");
  if (/\/responses$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }
  if (/\/chat\/completions$/i.test(pathname)) {
    return `${trimTrailingSlashes(`${url.origin}${pathname.replace(/\/chat\/completions$/i, "")}`)}/responses${url.search}`;
  }
  if (pathname === "" || pathname === "/") {
    return `${url.origin}/v1/responses${url.search}`;
  }
  return appendPath(url, "/responses");
}
function buildAnthropicMessagesUrl(baseUrl, fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.anthropic) {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || "/");
  if (/\/messages$/i.test(pathname)) {
    return trimTrailingSlashes(`${url.origin}${pathname}`) + url.search;
  }
  if (pathname === "" || pathname === "/") {
    return `${url.origin}/v1/messages${url.search}`;
  }
  return appendPath(url, "/messages");
}
function buildGoogleGenerateContentUrl(baseUrl, model, _apiKey, fallbackBaseUrl = DEFAULT_OPENAI_BASE_URLS.google) {
  const source = baseUrl?.trim() ? baseUrl : fallbackBaseUrl;
  const url = parseUrlOrThrow(source);
  const pathname = trimTrailingSlashes(url.pathname || "/");
  const encodedModel = encodeURIComponent(model);
  if (/\/models\/[^/]+:generateContent$/i.test(pathname)) {
    const existing = trimTrailingSlashes(`${url.origin}${pathname}`);
    return `${existing}${url.search}`;
  }
  const base = pathname === "" || pathname === "/" ? `${url.origin}/v1beta` : trimTrailingSlashes(`${url.origin}${pathname}`);
  return `${base}/models/${encodedModel}:generateContent`;
}
function sanitizeLLMErrorText(text, apiKey) {
  let sanitized = text;
  if (apiKey?.trim()) {
    sanitized = sanitized.split(apiKey.trim()).join("[redacted]");
  }
  sanitized = sanitized.replace(/([?&](?:token|access_token|api_key|key)=)[^&\s]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  sanitized = sanitized.replace(/(Authorization["'\s:=]+)(?:Bearer\s+)?[^"',\s}]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/(x-api-key["'\s:=]+)[^"',\s}]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/(key=)[^&\s]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/(api[_-]?key["'\s:=]+)[^"',\s}]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/[A-Za-z]:\\[^\s"',)]+/g, "[local-path]");
  sanitized = sanitized.replace(/\/(?:Users|home|var|tmp)\/[^\s"',)]+/g, "[local-path]");
  return sanitized;
}
function bodyContains(body, patterns) {
  const text = body?.toLowerCase() ?? "";
  return patterns.some((pattern) => pattern.test(text));
}
function extractProviderErrorDetail(body) {
  if (!body.trim()) return "";
  try {
    const parsed = JSON.parse(body);
    const detail = parsed.error?.message ?? parsed.message;
    return typeof detail === "string" ? detail.trim().slice(0, 300) : "";
  } catch {
    return body.trim().replace(/\s+/g, " ").slice(0, 300);
  }
}
function classifyLLMError({
  status,
  body,
  error,
  mode = "direct",
  apiKey
}) {
  const rawMessage = error instanceof Error ? error.message : error == null ? "" : String(error);
  const safeBody = sanitizeLLMErrorText(body ?? "", apiKey).slice(0, 600);
  const safeMessage = sanitizeLLMErrorText(rawMessage, apiKey);
  const text = `${safeMessage}
${safeBody}`;
  if (/cancelled by (?:the )?user|request was cancelled|task cancelled/i.test(text)) {
    return { category: "cancelled", message: "Request was cancelled.", status };
  }
  if (/timeout|abort/i.test(text)) {
    return { category: "timeout", message: "Network request timed out. Check the network or proxy service.", status };
  }
  if (/fetch failed|failed to fetch|network request failed|enotfound|econnrefused|dns|certificate/i.test(text)) {
    return { category: "base_url", message: "Base URL is not reachable. Check the address, protocol, and proxy service.", status };
  }
  if (status === 401) {
    return { category: "api_key", message: "API Key is invalid, expired, or rejected by the provider.", status };
  }
  if (status === 403) {
    return { category: "permission", message: "API Key does not have permission for this model or service.", status };
  }
  if (status === 404) {
    const isModelProblem = bodyContains(safeBody, [
      /model[^\n]{0,80}(?:not\s*found|does\s*not\s*exist|unavailable)/,
      /(?:not\s*found|does\s*not\s*exist|unavailable)[^\n]{0,80}model/
    ]);
    return {
      category: isModelProblem ? "model_not_found" : "base_url",
      message: isModelProblem ? "Model is unavailable. Check the model name and account access." : "Base URL or endpoint path was not found. Check whether /v1 or /responses is duplicated or missing.",
      status
    };
  }
  if (status === 429) {
    return { category: "rate_limited", message: "Request was rate limited. Try again later or check account quota.", status };
  }
  if (status && [400, 405, 415, 422].includes(status)) {
    const isModelProblem = bodyContains(safeBody, [
      /model[^\n]{0,80}(?:not\s*found|does\s*not\s*exist|unavailable)/,
      /(?:not\s*found|does\s*not\s*exist|unavailable)[^\n]{0,80}model/,
      /unsupported\s*model/
    ]);
    const providerDetail = extractProviderErrorDetail(safeBody);
    return {
      category: isModelProblem ? "model_not_found" : "request_format",
      message: isModelProblem ? "Model is unavailable. Check the model name and account access." : providerDetail ? `Request format is incompatible: ${providerDetail}` : "Request format is incompatible. Confirm the service supports the provider API.",
      status
    };
  }
  if (status && [502, 503, 504].includes(status)) {
    return {
      category: mode === "proxy" ? "proxy" : "server",
      message: mode === "proxy" ? "Proxy service error. Check the proxy status or upstream model service." : "Model service is temporarily unavailable. Try again later.",
      status
    };
  }
  if (status && status >= 500) {
    return {
      category: "server",
      message: "Model service returned a server error. Try again later.",
      status
    };
  }
  if (/choices|candidate|content|empty response|no text/i.test(text)) {
    return {
      category: "empty_response",
      message: "Model response was empty or incomplete. Check whether the model supports this request format.",
      status
    };
  }
  return {
    category: "unknown",
    message: safeMessage || safeBody || "Model connection failed. Check the configuration and try again.",
    status
  };
}
function createLLMClientError(input) {
  return new LLMClientError(classifyLLMError(input));
}

// packages/shared/src/api/llmClient.ts
var SECRET_QUERY_PARAMS = /* @__PURE__ */ new Set(["key", "api_key", "token", "access_token"]);
function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}
function assertSafeLLMEndpoint(url) {
  const parsedUrl = new URL(url);
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP(S) LLM endpoints are allowed.");
  }
  for (const key of parsedUrl.searchParams.keys()) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
      throw new Error("LLM endpoint URLs must not include API keys or tokens in query parameters.");
    }
  }
  if (parsedUrl.protocol === "http:" && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error("Plain HTTP LLM endpoints are limited to localhost.");
  }
}
function cleanLLMOutput(text) {
  return text.replace(/<\|[^|>]*\|>/g, "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*```(?:[a-z0-9_-]+)?\s*/i, "").replace(/\s*```\s*$/i, "").replace(/^'''[\s\S]*?'''\s*/m, "").replace(/^\s+|\s+$/g, "");
}
var CONNECTION_TEST_IMAGE_BASE64 = "/9j/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAgACADAREAAhEBAxEB/8QAGQABAAIDAAAAAAAAAAAAAAAABQQGAQMH/8QAJBAAAgMBAAIDAAEFAAAAAAAAAwQBAgUGBxIRExQACBUWIzP/xAAaAQEAAgMBAAAAAAAAAAAAAAAFBAYAAgMH/8QAIxEAAwEAAgMBAAMAAwAAAAAAAQIDBAUTBhESFAAiIxUzNP/aAAwDAQACEQMRAD8AsPHJ8Tmd4Xm+Dx7dHyOb0G+VlPHC6jk5BTWMB1KZQCIBhiQuSL6ERBlVzVW+CewqQFzUeX4Dg8icldZW1iHtTdbU0xlar19LeorMGsxRZOoWursvpaej5cVbybR5Jq5LPDibSewDGmaslLKaJR0YgMJzh7eEaemYWq7Woog0oSH8g+Vt3F5pyvY7Rba2p0CW90QGkhFEqfNZSIGh8tQMT6l+cqCydkNDluc8TW4oFVnBk8R4/wAPfj8SgxWeuUGh2GkZ2S4Fk0gFaNKstoxiJjNZfbanNW0USzuMnmGnTupnbTxEGl8dcpCmpfVhRzW2wPRE6bZ2ajXZoZ5s1vnPRUneReK8muC57x5g+KuSyOb1RWtj5yyRdF6WHChIdFtoctkijTUjD7LK1hkrpaX/AD2GW91fHtvCy4/Xmy6zTTYh0Bp0j8tiVQ5nboMILR4gSo8WiEWsP3VpImDLmo6ORsp1l01LKWrZjrMNchnCdVpZ+yv/AEVu4rEEvHqjKmJa6Tpy+P54OXScTqWtKyKBsjdSEkvdKUVna57FAItqGWVG0YKZzQSKlvUkVlT89BCoH41fXmZc7Eq9PTq9tj1caKe9XrPTHdbh3t0rObZqpLRRGD6qPM2R4jZwvLUU8rXMsaCrv8K32zCecZjOK1H1VFcNPMM060MvxSN507XPGzy/BKE5u/jrnU8i7SoEWtUM2e22AUHA/dRYFxgdAxnsAogRahJIu0a14tNifyV4Rx7U3y1c2Xtyv6dOz2k6Og+pqCzUalSOyjuaVRwZmCBgnVVGn8kmLkm4jkfrT85puXEg2ZlylW3V9bM1PtZHRGi0EdVbSfroUrSdDow2x6cw9y3RG5i3RaWKboUOmfeMdzOzgmkFV1mmhUFDQwmsOy1wUXn9X5rkFavzQ/N41Lj/ACHNxWE3VTWUc5mfyo7pOzdmnLP9GkRev0BRC4rR0vmmpNAwXD68fnWfBHVLReLOO2Mo/ItdJRqukplFMlFMJz9tMepy/HB6WeopOb4/Pw/S8lThvLGn1CH49P8AsYNLqHrQACkWP+/N+64BGD7rMaiJFwye4IvUlKjHAbisWwVTyunMYTM1ppr8CtQLfon8jG8yj6pLOV4ZwfVAu510zaFWVY/xJfFef8a8Z1X0pOUuxbNklltB+uxekFzGsrgHRX4dlR1nbRBYRs0tVmcjwBp6fN+SeU6zhHsPkMPW086vPx2jMw4kFdO5iqRQpbkoq3N5gse5h/6pvEDXiCWA5PD4zrbl8XKaMtVorOXV6mdXS6tJLaIkZpAUy6HmiVHV2oFN6Z5zHWPl3H8zlmnK3puaReTfPwi03VHUi1cu9IfDrmDTF6tvESpmyisgfhdBweYfPZ1PGFsArI8nZ0dgWFfPCXTeQLRRsK8AtEfDVWWbSOlxkISCsUoCkxaz78fI+T8NvxEzjuAabye3ZWBG2Xyn53HqOdu+SfYvPS01ZpQrVuuj23muV8R8G2cbOs9hrKyZs1ratS0jTRpSuYh/78pc98Xc1nP7XRBY0kJZq0k+R+mFrd91anIec+iejKxjp/4yrzdDIw2Jkyjo7r2zheuYsMUVt7RRe9Ae82EX0JUbxHgpauN4oc9hAFNTV9WQFwJ/6N1UpOVRR5Z+pozoK9tWCTQQEKVLgvHxyHCcfskpfY5ojb85pnz29/nbtmY3GiVL6tAzk5kMtVFew6SlTG1+ONvuOf0uvwWCdKhh6TaKeLruPMLs6UkdhYbMZ/6VXL2sj8BaNT5bClkkIM0QJcVtRxGK9YWx50d6aWe9ZLbTKVI10NZ5bK0MUdgk2nRVSYs6eoVbQlAVrjzfjPknH8dag21hNdQm0R22ZM9YtaMYvQ1Cdl/nMbe2vaOt5/nf86I05Pnm7czyPAd1XSVfEXYHuI9dmDWFo1JTNxnLDD72TDdj3UpNV4vUwBUkN7yWLcD2z57nuVkzQbOdH3Nn1sn11Lpc3YSxq7wh70aDTT2/FZM9rViy/wAneZpXyuqPq0VqvfOUw07rmnNKWnV3BTapL2revadGetgaOLw+ZXTn2d5H3eI8mMZYBZbYF+Zbe5MOMvnGnHAm2zcLLK9F7jr8Q/nsCqn7EKxNoNS1vRYDfJW4/luI/wCQoHVpt9dVhTNHszyZawnkR1mQv5qIx0U0PnlNMdNGd6y1PtyeznsGG0LT2xb6dVesNNRltpznJqp+ylNmh1SgTO7S0OJzmVWcfn4ZbDyN3x2mbm+/x+A4raSZFPTaTf33ptSAKav5woSySWqGo2eRe1AB9SLWPMWvUv8ACL8zxXDcvmzatN9mKoq1lr/l/UrTRAOdKxI/tkSRDMlFp2zp3HrP83l5j5P5AJbeP02XHVWbGmelFqtGWWq/WvWJVjlaUUzCdKzjPOMr2CtWoP8A6kO6z+x5zX8jKcDCpe+XQ6e+YkmkY0gUWzhEWI2ye8ohXqQtaWAH1tJCfeJc0jkWeI+O8LwPH5+P3a6Joc3TO9AyvnZnd4SgFjNlSxk9paKPGWVfyVcUhILa1+OQ8GzY6VhFf241bLTUXosktAxkyoGkPg3FZJoRgrvOchM95ac6yxss5HHZkaV+iW3LLegiVapUz46nahlrWFYbB/8Aqtlj+2fm9yLAXrekiJa9q894ze3MbcnZJf8AzzpmVq6ux3WYi2TWwno+2aTf0nn+VeL0qaLdmXxXitHC8hy+vPFZIk31yCP1pjNOk9qZNDNNvb5w9YO+mC0pTR9KVJdf/9k=";
async function testLLMConnection(provider, apiKey) {
  const config = {
    provider,
    apiKey,
    model: provider === "anthropic" ? "claude-3-5-sonnet-latest" : provider === "google" ? "gemini-2.5-flash" : "gpt-5.5",
    supportsVision: true
  };
  const client = new LLMClient(config);
  try {
    const result = await client.chat(
      [{ role: "user", content: 'Reply with just "ok".' }],
      { maxTokens: 32, temperature: 0 }
    );
    return { success: true, rawResponse: result };
  } catch (err) {
    if (err instanceof LLMClientError) {
      return { success: false, error: err.message };
    }
    const classified = classifyLLMError({ error: err, apiKey });
    return { success: false, error: classified.message };
  }
}
var LLMClient = class {
  constructor(config) {
    this.config = config;
  }
  getRequiredApiKey() {
    const apiKey = String(this.config.apiKey ?? "").trim();
    if (apiKey) {
      return apiKey;
    }
    if (this.config.hasApiKey) {
      throw new Error(
        "API key is not loaded in the current session. Re-enter it before testing or running AI actions."
      );
    }
    throw new Error("API key is not configured. Complete setup in Settings first.");
  }
  supportsVision() {
    if (this.config.mode === "proxy") {
      return configSupportsVision(this.config);
    }
    return modelSupportsVision(
      this.config.provider,
      this.config.model,
      this.config.baseUrl
    );
  }
  async compressImageDataUrl(dataUrl) {
    const globalScope = globalThis;
    const documentLike = globalScope.document;
    const ImageCtor = globalScope.Image;
    if (!documentLike || !ImageCtor) {
      return dataUrl;
    }
    return new Promise((resolve) => {
      const img = new ImageCtor();
      img.crossOrigin = "anonymous";
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
        const canvas = documentLike.createElement?.("canvas");
        if (!canvas || typeof canvas.getContext !== "function" || typeof canvas.toDataURL !== "function") {
          resolve(dataUrl);
          return;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  async fetchWithTimeout(url, init, timeoutMs = 6e4) {
    assertSafeLLMEndpoint(url);
    const maybeWindow = typeof globalThis !== "undefined" && "window" in globalThis ? globalThis.window : void 0;
    const electronLlm = maybeWindow?.electronAPI?.llm?.call;
    if (electronLlm) {
      const result = await electronLlm({
        url,
        method: init.method ?? "POST",
        headers: init.headers,
        body: init.body
      });
      return new Response(result.body, { status: result.status });
    }
    const controller = new AbortController();
    const externalSignal = init.signal;
    let didTimeout = false;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) {
      throw createLLMClientError({
        error: new Error("Request was cancelled by user."),
        mode: this.config.mode,
        apiKey: this.config.apiKey
      });
    }
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, Math.max(50, timeoutMs));
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal
      });
      return response;
    } catch (err) {
      const wasExternallyAborted = Boolean(externalSignal?.aborted);
      throw createLLMClientError({
        error: didTimeout ? new Error("Request timeout.") : wasExternallyAborted ? new Error("Request was cancelled by user.") : err,
        mode: this.config.mode,
        apiKey: this.config.apiKey
      });
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }
  getBaseUrl() {
    return normalizeProviderBaseUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider)
    );
  }
  isOfficialAnthropicBaseUrl() {
    if (!this.config.baseUrl) {
      return true;
    }
    return getHttpUrlHostname(this.getBaseUrl()) === "api.anthropic.com";
  }
  buildOpenAIMessages(messages) {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content
    }));
  }
  hasImage(messages) {
    return messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")
    );
  }
  shouldUseResponsesApi() {
    return this.config.mode !== "proxy" && (this.config.provider === "openai" || this.config.provider === "custom");
  }
  async ensureCompressedMessages(messages) {
    const processed = [];
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        processed.push(msg);
      } else {
        const newContent = await Promise.all(
          msg.content.map(async (part) => {
            if (part.type === "image_url") {
              const compressed = await this.compressImageDataUrl(part.image_url.url);
              return { ...part, image_url: { ...part.image_url, url: compressed } };
            }
            return part;
          })
        );
        processed.push({ ...msg, content: newContent });
      }
    }
    return processed;
  }
  async callOpenAICompatible(messages, options) {
    const url = buildOpenAIChatCompletionsUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider)
    );
    let model = this.config.model;
    const isKimiK2 = this.config.provider === "moonshot" && model.startsWith("kimi-k2");
    const compressedMessages = await this.ensureCompressedMessages(messages);
    const body = {
      model,
      messages: this.buildOpenAIMessages(compressedMessages),
      max_tokens: options.maxTokens ?? 2048
    };
    const temperature = isKimiK2 ? 1 : options.temperature;
    if (typeof temperature === "number") {
      body.temperature = temperature;
    }
    if (isKimiK2) body["top_p"] = 0.95;
    const authKey = this.getRequiredApiKey();
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authKey}`
      },
      body: JSON.stringify(body),
      ...options.signal ? { signal: options.signal } : {}
    }, options.timeoutMs);
    if (!resp.ok) {
      const text = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        apiKey: authKey
      });
    }
    const data = await resp.json();
    if (!data.choices || data.choices.length === 0) {
      throw createLLMClientError({
        error: new Error("OpenAI-compatible response has no choices"),
        mode: this.config.mode,
        apiKey: authKey
      });
    }
    const choice = data.choices[0];
    const rawContent = choice.message?.content ?? choice.delta?.content ?? "";
    const contentFromParts = Array.isArray(rawContent) ? rawContent.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    }).join("") : rawContent;
    const content = cleanLLMOutput(
      typeof contentFromParts === "object" ? JSON.stringify(contentFromParts) : String(contentFromParts)
    );
    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens
    } : void 0;
    return {
      content,
      ...usage ? { usage } : {}
    };
  }
  buildResponsesInput(messages) {
    return messages.map((msg) => {
      const content = typeof msg.content === "string" ? [{ type: "input_text", text: msg.content }] : msg.content.map((part) => {
        if (part.type === "text") {
          return { type: "input_text", text: part.text };
        }
        return {
          type: "input_image",
          image_url: part.image_url.url,
          ...part.image_url.detail ? { detail: part.image_url.detail } : {}
        };
      });
      return {
        role: msg.role,
        content
      };
    });
  }
  extractResponsesText(data) {
    if (typeof data?.output_text === "string") {
      return data.output_text;
    }
    const output = Array.isArray(data?.output) ? data.output : [];
    const parts = [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (typeof part?.text === "string") {
          parts.push(part.text);
        } else if (typeof part?.output_text === "string") {
          parts.push(part.output_text);
        } else if (part?.type === "output_text" && typeof part?.text === "string") {
          parts.push(part.text);
        }
      }
    }
    return parts.join("");
  }
  async callOpenAIResponses(messages, options) {
    const url = buildOpenAIResponsesUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider)
    );
    const compressedMessages = await this.ensureCompressedMessages(messages);
    const body = {
      model: this.config.model,
      input: this.buildResponsesInput(compressedMessages),
      max_output_tokens: options.maxTokens ?? 2048
    };
    if (typeof options.temperature === "number") {
      body.temperature = options.temperature;
    }
    const authKey = this.getRequiredApiKey();
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authKey}`
      },
      body: JSON.stringify(body),
      ...options.signal ? { signal: options.signal } : {}
    }, options.timeoutMs);
    if (!resp.ok) {
      const text = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text,
        mode: this.config.mode,
        apiKey: authKey
      });
    }
    const data = await resp.json();
    const content = cleanLLMOutput(this.extractResponsesText(data));
    if (!content) {
      throw createLLMClientError({
        error: new Error("Responses API response has no output text"),
        mode: this.config.mode,
        apiKey: authKey
      });
    }
    const usage = data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens
    } : void 0;
    return {
      content,
      ...usage ? { usage } : {}
    };
  }
  async callAnthropic(messages, options) {
    const url = buildAnthropicMessagesUrl(
      this.config.baseUrl,
      getDefaultProviderBaseUrl(this.config.provider)
    );
    const isOfficialAnthropic = this.isOfficialAnthropicBaseUrl();
    const compressedMessages = await this.ensureCompressedMessages(messages);
    const systemMessages = compressedMessages.filter((m) => m.role === "system");
    const nonSystemMessages = compressedMessages.filter((m) => m.role !== "system");
    const systemPrompt = systemMessages.length > 0 ? typeof systemMessages[0].content === "string" ? systemMessages[0].content : "" : void 0;
    const anthropicMessages = nonSystemMessages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      const parts = msg.content.map((part) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        } else {
          const url2 = part.image_url.url;
          const base64Match = url2.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: base64Match[1],
                data: base64Match[2]
              }
            };
          }
          return { type: "text", text: `[Image: ${url2}]` };
        }
      });
      return { role: msg.role, content: parts };
    });
    const body = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 2048
    };
    if (typeof options.temperature === "number") {
      body.temperature = options.temperature;
    }
    if (systemPrompt) body["system"] = systemPrompt;
    const authKey = this.getRequiredApiKey();
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": authKey,
      "anthropic-version": "2023-06-01"
    };
    if (!isOfficialAnthropic) {
      headers["Authorization"] = `Bearer ${authKey}`;
    }
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...options.signal ? { signal: options.signal } : {}
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
        apiKey: authKey
      });
    }
    const data = await resp.json();
    const textBlock = data.content.find((c) => c.type === "text");
    if (!textBlock?.text) {
      throw createLLMClientError({
        error: new Error("No text content in Anthropic response"),
        mode: this.config.mode,
        apiKey: authKey
      });
    }
    const content = cleanLLMOutput(
      typeof textBlock.text === "object" ? JSON.stringify(textBlock.text) : String(textBlock.text)
    );
    const usage = data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens
    } : void 0;
    return {
      content,
      ...usage ? { usage } : {}
    };
  }
  async callGoogle(messages, options) {
    const model = this.config.model || "gemini-2.5-flash";
    const apiKey = this.getRequiredApiKey();
    const url = buildGoogleGenerateContentUrl(
      this.config.baseUrl,
      model,
      apiKey,
      getDefaultProviderBaseUrl(this.config.provider)
    );
    const compressedMessages = await this.ensureCompressedMessages(messages);
    const contents = compressedMessages.filter((m) => m.role !== "system").map((msg) => {
      const role = msg.role === "assistant" ? "model" : "user";
      if (typeof msg.content === "string") {
        return { role, parts: [{ text: msg.content }] };
      }
      const parts2 = msg.content.map((part) => {
        if (part.type === "text") return { text: part.text };
        const url2 = part.image_url.url;
        const base64Match = url2.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          return {
            inline_data: {
              mime_type: base64Match[1],
              data: base64Match[2]
            }
          };
        }
        return { text: `[Image: ${url2}]` };
      });
      return { role, parts: parts2 };
    });
    const systemInstruction = compressedMessages.find((m) => m.role === "system");
    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 2048
      }
    };
    if (typeof options.temperature === "number") {
      body.generationConfig.temperature = options.temperature;
    }
    if (systemInstruction) {
      body["system_instruction"] = {
        parts: [
          {
            text: typeof systemInstruction.content === "string" ? systemInstruction.content : ""
          }
        ]
      };
    }
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      ...options.signal ? { signal: options.signal } : {}
    }, options.timeoutMs);
    if (!resp.ok) {
      const text2 = await resp.text();
      throw createLLMClientError({
        status: resp.status,
        body: text2,
        mode: this.config.mode,
        apiKey
      });
    }
    const data = await resp.json();
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
      throw createLLMClientError({
        error: new Error("Google response has no candidates"),
        mode: this.config.mode,
        apiKey
      });
    }
    const candidate = data.candidates[0];
    const parts = candidate?.content?.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw createLLMClientError({
        error: new Error("Google response has no content parts"),
        mode: this.config.mode,
        apiKey
      });
    }
    const rawText = parts.map((p) => p.text || "").join("");
    const text = cleanLLMOutput(
      typeof rawText === "object" ? JSON.stringify(rawText) : String(rawText)
    );
    const usage = data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount
    } : void 0;
    return {
      content: text,
      ...usage ? { usage } : {}
    };
  }
  async chat(messages, options = {}) {
    if (this.config.mode === "proxy") {
      return this.callOpenAICompatible(messages, options);
    }
    if (this.shouldUseResponsesApi()) {
      return this.callOpenAIResponses(messages, options);
    }
    switch (this.config.provider) {
      case "anthropic":
        return this.callAnthropic(messages, options);
      case "google":
        return this.callGoogle(messages, options);
      default:
        return this.callOpenAICompatible(messages, options);
    }
  }
  async testConnection() {
    const isKimiK2 = this.config.provider === "moonshot" && this.config.model?.startsWith("kimi-k2");
    const maxTokens = isKimiK2 ? 2048 : 32;
    const shouldTestVision = this.supportsVision();
    try {
      const response = shouldTestVision ? await this.chatWithImage(
        'This is an application-generated connection test image. Reply with just "ok".',
        CONNECTION_TEST_IMAGE_BASE64,
        "image/jpeg",
        { maxTokens, temperature: 0, timeoutMs: 2e4 }
      ) : await this.chat(
        [{ role: "user", content: 'Reply with just "ok".' }],
        { maxTokens, temperature: 0, timeoutMs: 2e4 }
      );
      if (response.content) {
        return { success: true, mode: shouldTestVision ? "vision" : "text" };
      }
      return {
        success: false,
        mode: shouldTestVision ? "vision" : "text",
        error: "Empty model response.",
        category: "empty_response"
      };
    } catch (err) {
      if (err instanceof LLMClientError) {
        return {
          success: false,
          mode: shouldTestVision ? "vision" : "text",
          error: err.message,
          category: err.category,
          ...err.status ? { status: err.status } : {}
        };
      }
      const classified = classifyLLMError({
        error: err,
        mode: this.config.mode,
        apiKey: this.config.apiKey
      });
      return {
        success: false,
        mode: shouldTestVision ? "vision" : "text",
        error: classified.message,
        category: classified.category,
        ...classified.status ? { status: classified.status } : {}
      };
    }
  }
  async chatWithImage(prompt, imageBase64, mimeType, options = {}) {
    if (!this.supportsVision()) {
      throw new Error(`Provider ${this.config.provider} does not support vision`);
    }
    const dataUrl = `data:${mimeType};base64,${imageBase64}`;
    if (this.config.provider === "anthropic" && this.config.mode !== "proxy") {
      const messages2 = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: prompt }
          ]
        }
      ];
      return this.callAnthropic(messages2, options);
    }
    if (this.config.provider === "google" && this.config.mode !== "proxy") {
      const messages2 = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: prompt }
          ]
        }
      ];
      return this.callGoogle(messages2, options);
    }
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          { type: "text", text: prompt }
        ]
      }
    ];
    return this.chat(messages, options);
  }
};

// packages/shared/src/api/multimodalClient.ts
function createMultimodalClient(config) {
  return new LLMClient(config);
}
async function executeImageInstruction(client, input) {
  const response = await client.chatWithImage(
    input.instruction,
    input.imageBase64,
    input.mimeType,
    input.requestOptions
  );
  return response.content;
}
function createProviderConfig(input) {
  const supportsVision = input.mode === "proxy" ? proxyModelSupportsVision(input.provider, input.model, input.baseUrl) : modelSupportsVision(input.provider, input.model, input.baseUrl);
  return {
    provider: input.provider,
    model: input.model,
    supportsVision,
    ...input.apiKey !== void 0 ? { apiKey: input.apiKey } : {},
    ...input.baseUrl !== void 0 ? { baseUrl: input.baseUrl } : {},
    ...input.mode !== void 0 ? { mode: input.mode } : {}
  };
}
export {
  LLMClient,
  LLMClientError,
  PROVIDER_MODELS,
  buildAnthropicMessagesUrl,
  buildGoogleGenerateContentUrl,
  buildOpenAIChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  classifyLLMError,
  configSupportsVision,
  createLLMClientError,
  createMultimodalClient,
  createProviderConfig,
  executeImageInstruction,
  formatProviderRouteLabel,
  getConfiguredProviders,
  getDefaultProviderBaseUrl,
  modelSupportsVision,
  normalizeProviderBaseUrl,
  providerHasVisionModels,
  proxyModelSupportsVision,
  resolveProviderRoute,
  sanitizeLLMErrorText,
  testLLMConnection
};
