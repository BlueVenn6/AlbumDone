import React, { useState, useCallback, useEffect } from 'react';
import { colors, typography, spacing, radius } from '../theme';
import {
  useSettingsStore,
  PROVIDER_MODELS,
  configSupportsVision,
  formatProviderRouteLabel,
  getConfiguredProviders,
  modelSupportsVision,
  useTranslation,
} from '@photo-manager/shared';
import type { LLMProvider, ProviderConfig, ProviderMode, TrashRetentionDays } from '@photo-manager/shared';

const PROVIDERS = Object.entries(PROVIDER_MODELS) as [LLMProvider, typeof PROVIDER_MODELS[LLMProvider]][];
const API_ERROR_KEY_BY_CATEGORY: Record<string, string> = {
  api_key: 'settings.apiConfig.errors.apiKey',
  permission: 'settings.apiConfig.errors.permission',
  base_url: 'settings.apiConfig.errors.baseUrl',
  network: 'settings.apiConfig.errors.baseUrl',
  model_not_found: 'settings.apiConfig.errors.modelNotFound',
  request_format: 'settings.apiConfig.errors.requestFormat',
  rate_limited: 'settings.apiConfig.errors.rateLimited',
  proxy: 'settings.apiConfig.errors.proxy',
  server: 'settings.apiConfig.errors.server',
  timeout: 'settings.apiConfig.errors.timeout',
  empty_response: 'settings.apiConfig.errors.emptyResponse',
  unknown: 'settings.apiConfig.errors.unknown',
};

function getEndpointRiskKey(baseUrl: string): { level: 'low' | 'medium' | 'local' | 'high' | 'blocked'; key: string } | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.invalid' };
  }

  for (const key of parsed.searchParams.keys()) {
    if (['key', 'api_key', 'token', 'access_token'].includes(key.toLowerCase())) {
      return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.querySecret' };
    }
  }

  if (parsed.protocol === 'https:') {
    const officialHosts = [
      'api.openai.com',
      'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'api.moonshot.cn',
      'api.moonshot.ai',
      'open.bigmodel.cn',
      'dashscope.aliyuncs.com',
      'api.minimax.chat',
      'api.deepseek.com',
    ];
    return officialHosts.includes(parsed.hostname)
      ? { level: 'low', key: 'settings.apiConfig.endpointRisk.officialHttps' }
      : { level: 'medium', key: 'settings.apiConfig.endpointRisk.thirdPartyHttps' };
  }

  if (parsed.protocol === 'http:') {
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())) {
      return { level: 'local', key: 'settings.apiConfig.endpointRisk.localhostHttp' };
    }
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(parsed.hostname)) {
      return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.lanHttp' };
    }
    return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.remoteHttp' };
  }

  return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.unsupported' };
}

export function SettingsScreen(): React.JSX.Element {
  const settings = useSettingsStore();
  const { t } = useTranslation();
  const [expandedProvider, setExpandedProvider] = useState<LLMProvider | null>(null);
  const visionProviders = getConfiguredProviders(settings.providers, {
    requiresVision: true,
    allowMissingApiKey: true,
  });
  const textProviders = getConfiguredProviders(settings.providers, { allowMissingApiKey: true });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('settings.title')}</h1>
      </div>

      <div style={styles.content}>
        {/* API Configuration */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('settings.apiConfig.title')}</h2>
          <p style={styles.sectionDesc}>{t('settings.apiConfig.description')}</p>
          <div style={styles.providerList}>
            {PROVIDERS.map(([key, meta]) => (
              <ProviderCard
                key={key}
                providerKey={key}
                meta={meta}
                config={settings.providers[key]}
                expanded={expandedProvider === key}
                onToggle={() => setExpandedProvider(expandedProvider === key ? null : key)}
                onSave={(config) => settings.updateProvider(key, config)}
                onRemove={() => settings.removeProvider(key)}
              />
            ))}
          </div>
        </section>

        {/* Default Providers */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('settings.taskRouting.title')}</h2>
          <div style={styles.row}>
            <div style={styles.rowLabel}>
              <span style={styles.label}>{t('settings.taskRouting.vision')}</span>
              <span style={styles.labelDesc}>{t('settings.taskRouting.visionDesc')}</span>
            </div>
            <ProviderSelector
              value={settings.defaultVisionProvider}
              onChange={settings.setDefaultVisionProvider}
              providers={visionProviders}
              configs={settings.providers}
            />
          </div>
          <div style={styles.row}>
            <div style={styles.rowLabel}>
              <span style={styles.label}>{t('settings.taskRouting.text')}</span>
              <span style={styles.labelDesc}>{t('settings.taskRouting.textDesc')}</span>
            </div>
            <ProviderSelector
              value={settings.defaultTextProvider}
              onChange={settings.setDefaultTextProvider}
              providers={textProviders}
              configs={settings.providers}
            />
          </div>
        </section>

        {/* Trash retention */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>{t('settings.trash.title')}</h2>
          <div style={styles.toggleRow}>
            {([7, 14, 30] as TrashRetentionDays[]).map((days) => (
              <button
                key={days}
                onClick={() => settings.updateTrashRetention(days)}
                style={{
                  ...styles.toggleBtn,
                  ...(settings.trashRetentionDays === days ? styles.toggleActive : {}),
                }}
              >
                {t('common.days', { count: days })}
              </button>
            ))}
          </div>
        </section>

        {/* OCR & Translation */}
        <OcrTranslationSection />

        {/* Custom Instructions */}
        <CustomInstructionsSection />
      </div>
    </div>
  );
}

function ProviderCard({
  providerKey,
  meta,
  config,
  expanded,
  onToggle,
  onSave,
  onRemove,
}: {
  providerKey: LLMProvider;
  meta: typeof PROVIDER_MODELS[LLMProvider];
  config?: ProviderConfig;
  expanded: boolean;
  onToggle: () => void;
  onSave: (config: ProviderConfig) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const isPresetModel = (m: string | undefined) => Boolean(m && meta.models.includes(m));
  const getModelSelectValue = (m: string | undefined) =>
    m && meta.models.length > 0 && !isPresetModel(m) ? '__custom__' : (m ?? meta.models[0] ?? '');
  const [model, setModel] = useState(() => getModelSelectValue(config?.model));
  const [customModel, setCustomModel] = useState(() =>
    config?.model && meta.models.length > 0 && !isPresetModel(config.model) ? config.model : '',
  );
  const [mode, setMode] = useState<ProviderMode>(config?.mode ?? 'direct');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [keyStatus, setKeyStatus] = useState<{ hasApiKey: boolean; maskedKey?: string } | null>(null);

  // Sync local state when the zustand store rehydrates from localStorage after app start.
  // Without this, the input fields appear blank even though keys are saved.
  useEffect(() => {
    if (config?.baseUrl !== undefined) setBaseUrl(config.baseUrl ?? '');
    if (config?.model) {
      setModel(getModelSelectValue(config.model));
      if (meta.models.length > 0 && !isPresetModel(config.model)) {
        setCustomModel(config.model);
      }
    }
    setMode(config?.mode ?? 'direct');
  }, [config?.baseUrl, config?.model, config?.mode]);

  useEffect(() => {
    if (!expanded) return;
    window.electronAPI?.settings?.getApiKeyStatus(providerKey)
      .then((status) => {
        setKeyStatus(status ? {
          hasApiKey: status.hasApiKey,
          maskedKey: status.maskedKey,
        } : null);
      })
      .catch(() => setKeyStatus(null));
  }, [expanded, providerKey, config?.hasApiKey]);

  const buildCurrentConfig = useCallback((): ProviderConfig => {
    const finalModel = (meta.models.length === 0 || model === '__custom__' ? customModel : model).trim();
    return {
      provider: providerKey,
      hasApiKey: Boolean(apiKey.trim() || keyStatus?.hasApiKey || config?.hasApiKey),
      baseUrl: baseUrl.trim() || undefined,
      model: finalModel,
      supportsVision: mode === 'proxy'
        ? meta.supportsVision
        : modelSupportsVision(providerKey, finalModel, baseUrl || undefined),
      mode,
    };
  }, [apiKey, baseUrl, config?.hasApiKey, customModel, keyStatus?.hasApiKey, meta.supportsVision, mode, model, providerKey]);

  const persistCurrentConfig = useCallback(async (nextConfig: ProviderConfig) => {
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey) {
      await window.electronAPI?.settings?.setApiKey(providerKey, trimmedApiKey);
      const status = await window.electronAPI?.settings?.getApiKeyStatus(providerKey).catch(() => null);
      if (status) {
        setKeyStatus({
          hasApiKey: status.hasApiKey,
          maskedKey: status.maskedKey,
        });
      }
      setApiKey('');
    }
    onSave({
      ...nextConfig,
      hasApiKey: Boolean(trimmedApiKey || nextConfig.hasApiKey),
    });
  }, [apiKey, onSave, providerKey]);

  // Persist to Electron secure storage AND the zustand store on every save.
  const handleSave = useCallback(async () => {
    if (providerKey === 'qwen' && mode === 'direct' && !baseUrl.trim()) {
      setTestResult({ ok: false, msg: t('settings.apiConfig.qwenWorkspaceRequired') });
      return;
    }
    const endpointRisk = getEndpointRiskKey(baseUrl);
    if (endpointRisk?.level === 'blocked') {
      window.alert(t(endpointRisk.key));
      return;
    }
    if (endpointRisk && !window.confirm(`${t(endpointRisk.key)}\n\n${t('settings.apiConfig.endpointContinue')}`)) {
      return;
    }
    await persistCurrentConfig(buildCurrentConfig());
  }, [baseUrl, buildCurrentConfig, mode, persistCurrentConfig, providerKey, t]);

  const handleTest = useCallback(async () => {
    if (!apiKey.trim() && !keyStatus?.hasApiKey && !config?.hasApiKey) return;
    if (providerKey === 'qwen' && mode === 'direct' && !baseUrl.trim()) {
      setTestResult({ ok: false, msg: t('settings.apiConfig.qwenWorkspaceRequired') });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const nextConfig = buildCurrentConfig();
      const { success, error, category, status } = await window.electronAPI!.llm.testConnection({
        provider: providerKey,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl: nextConfig.baseUrl,
        model: nextConfig.model,
        supportsVision: nextConfig.supportsVision,
        mode: nextConfig.mode,
      });
      if (success) {
        await persistCurrentConfig(nextConfig);
      }
      const errorKey = category ? API_ERROR_KEY_BY_CATEGORY[category] : undefined;
      const statusSuffix = status ? ` (HTTP ${status})` : '';
      setTestResult({
        ok: success,
        msg: success
          ? t('settings.apiConfig.testSuccess')
          : `${errorKey ? t(errorKey) : (error ?? t('settings.apiConfig.testBtn'))}${statusSuffix}`,
      });
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, buildCurrentConfig, mode, persistCurrentConfig, providerKey, t]);

  const handleRemove = useCallback(async () => {
    await window.electronAPI?.settings?.deleteApiKey(providerKey);
    onRemove();
    setApiKey('');
    setKeyStatus(null);
    setTestResult(null);
  }, [onRemove, providerKey]);

  const isConfigured = Boolean(config?.hasApiKey || keyStatus?.hasApiKey);
  const canTest = Boolean(apiKey.trim() || isConfigured);
  const canSave = Boolean(apiKey.trim() || isConfigured);

  return (
    <div style={styles.providerCard}>
      <button onClick={onToggle} style={styles.providerHeader}>
        <div style={styles.providerHeaderLeft}>
          <span style={styles.providerName}>{meta.name}</span>
          {isConfigured && (
            <span style={styles.configuredBadge}>{t('settings.apiConfig.configured')}</span>
          )}
        </div>
        <span style={styles.chevron}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={styles.providerBody}>
          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t('settings.apiConfig.keyLabel')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isConfigured ? (keyStatus?.maskedKey ?? t('settings.apiConfig.savedKeyPlaceholder')) : 'sk-…'}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.fieldLabel}>
              {t(providerKey === 'qwen' && mode === 'direct'
                ? 'settings.apiConfig.qwenBaseUrlLabel'
                : 'settings.apiConfig.baseUrlLabel')}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t(providerKey === 'qwen' && mode === 'direct'
                ? 'settings.apiConfig.qwenBaseUrlPlaceholder'
                : 'settings.apiConfig.baseUrlPlaceholder')}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t('settings.apiConfig.modeLabel')}</label>
            <div style={styles.modeToggle}>
              {(['direct', 'proxy'] as ProviderMode[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setMode(option)}
                  style={{
                    ...styles.modeToggleButton,
                    ...(mode === option ? styles.modeToggleButtonActive : {}),
                  }}
                >
                  {option === 'direct' ? t('settings.apiConfig.directMode') : t('settings.apiConfig.proxyMode')}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t('settings.apiConfig.modelLabel')}</label>
            {meta.models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={styles.select}
              >
                {meta.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">{t('settings.apiConfig.customModel')}</option>
              </select>
            ) : (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={t('settings.apiConfig.customModelPlaceholder')}
                style={styles.input}
              />
            )}
            {model === '__custom__' && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={t('settings.apiConfig.customModelPlaceholder')}
                style={{ ...styles.input, marginTop: spacing.xs }}
              />
            )}
          </div>

          {testResult && (
            <div style={{
              ...styles.testResult,
              borderColor: testResult.ok ? colors.success + '50' : colors.danger + '50',
              background: testResult.ok ? colors.successDim : colors.dangerDim,
            }}>
              <span style={{ color: testResult.ok ? colors.success : colors.danger, fontFamily: typography.fontFamily, fontSize: typography.sizes.sm }}>
                {testResult.ok ? '✓' : '✗'} {testResult.msg}
              </span>
            </div>
          )}

          <div style={styles.providerActions}>
            <button
              onClick={handleTest}
              disabled={!canTest || testing}
              style={{ ...styles.testBtn, opacity: (!canTest || testing) ? 0.5 : 1 }}
            >
              {testing ? t('settings.apiConfig.testing') : t('settings.apiConfig.testBtn')}
            </button>
            <button onClick={handleSave} disabled={!canSave} style={styles.saveBtn}>
              {t('common.save')}
            </button>
            {isConfigured && (
              <button onClick={handleRemove} style={styles.removeBtn}>
                {t('common.remove')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderSelector({
  value,
  onChange,
  providers,
  configs,
}: {
  value: LLMProvider | null;
  onChange: (p: LLMProvider | null) => void;
  providers: LLMProvider[];
  configs: Partial<Record<LLMProvider, ProviderConfig>>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? e.target.value as LLMProvider : null)}
      style={styles.select}
    >
      <option value="">{t('common.notSet')}</option>
      {providers.map((p) => {
        const config = configs[p];
        const label = config
          ? formatProviderRouteLabel({ provider: p, config })
          : PROVIDER_MODELS[p].name;
        return <option key={p} value={p}>{label}</option>;
      })}
    </select>
  );
}

function CustomInstructionsSection(): React.JSX.Element {
  const { customInstructions, addCustomInstruction, removeCustomInstruction, updateCustomInstruction } =
    useSettingsStore();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    if (!name.trim() || !prompt.trim()) return;
    addCustomInstruction({ name: name.trim(), prompt: prompt.trim() });
    setName('');
    setPrompt('');
  }, [name, prompt, addCustomInstruction]);

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{t('settings.customInstructions.title')}</h2>
      <div style={styles.customList}>
        {customInstructions.map((ci) => (
          <div key={ci.id} style={styles.customItem}>
            {editingId === ci.id ? (
              <div style={styles.customEditRow}>
                <input
                  defaultValue={ci.name}
                  onBlur={(e) => updateCustomInstruction(ci.id, { name: e.target.value })}
                  style={{ ...styles.input, flex: '0 0 140px' }}
                />
                <input
                  defaultValue={ci.prompt}
                  onBlur={(e) => updateCustomInstruction(ci.id, { prompt: e.target.value })}
                  style={{ ...styles.input, flex: 1 }}
                />
                <button onClick={() => setEditingId(null)} style={styles.doneEditBtn}>
                  {t('settings.customInstructions.editDone')}
                </button>
              </div>
            ) : (
              <>
                <div style={styles.customInfo}>
                  <span style={styles.customName}>{ci.name}</span>
                  <span style={styles.customPrompt}>{ci.prompt}</span>
                </div>
                <div style={styles.customActions}>
                  <button onClick={() => setEditingId(ci.id)} style={styles.editBtn}>
                    {t('settings.customInstructions.editBtn')}
                  </button>
                  <button onClick={() => removeCustomInstruction(ci.id)} style={styles.removeBtn}>✕</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={styles.addCustomRow}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.customInstructions.namePlaceholder')}
          style={{ ...styles.input, flex: '0 0 140px' }}
        />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('settings.customInstructions.promptPlaceholder')}
          style={{ ...styles.input, flex: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button onClick={handleAdd} disabled={!name || !prompt} style={styles.saveBtn}>
          {t('settings.customInstructions.addBtn')}
        </button>
      </div>
    </section>
  );
}

function OcrTranslationSection(): React.JSX.Element {
  const { deeplApiKey } = useSettingsStore();
  const settings = useSettingsStore();
  const { t } = useTranslation();
  const [deepl, setDeepl] = useState(deeplApiKey ?? '');

  useEffect(() => { if (deeplApiKey !== undefined) setDeepl(deeplApiKey); }, [deeplApiKey]);

  const handleSave = useCallback(() => {
    settings.updateDeeplApiKey(deepl);
  }, [deepl, settings]);

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{t('settings.ocrTranslation.title')}</h2>
      <div style={styles.field}>
        <label style={styles.fieldLabel}>DeepL API Key <span style={{ fontWeight: 400, textTransform: 'none' }}>({t('settings.ocrTranslation.optional')} — <a href="https://www.deepl.com/pro#developer" target="_blank" rel="noreferrer" style={{ color: colors.accent }}>deepl.com</a>)</span></label>
        <input
          type="password"
          value={deepl}
          onChange={(e) => setDeepl(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
          style={styles.input}
        />
      </div>
      <div>
        <button onClick={handleSave} style={styles.saveBtn}>{t('common.save')}</button>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.background,
    overflowY: 'auto',
  },
  header: {
    padding: `${spacing.xl} ${spacing.xl} ${spacing.md}`,
    borderBottom: `1px solid ${colors.border}`,
  },
  title: {
    margin: 0,
    fontSize: typography.sizes.xxl,
    fontWeight: '700',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xl,
    maxWidth: '720px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  },
  sectionTitle: {
    margin: 0,
    fontSize: typography.sizes.md,
    fontWeight: '600',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  sectionDesc: {
    margin: 0,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: '1.5',
  },
  providerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  providerCard: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  providerHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  providerHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  providerName: {
    fontSize: typography.sizes.sm,
    fontWeight: '500',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  configuredBadge: {
    fontSize: typography.sizes.xs,
    color: colors.success,
    background: colors.successDim,
    padding: '2px 8px',
    borderRadius: '999px',
    fontFamily: typography.fontFamily,
  },
  chevron: {
    fontSize: '11px',
    color: colors.textTertiary,
  },
  providerBody: {
    padding: spacing.md,
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: typography.fontFamily,
  },
  input: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  select: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamily,
    outline: 'none',
    cursor: 'pointer',
  },
  modeToggle: {
    display: 'flex',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    overflow: 'hidden',
    width: 'fit-content',
  },
  modeToggleButton: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surfaceElevated,
    border: 'none',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  modeToggleButtonActive: {
    background: colors.accentDim,
    color: colors.accent,
    fontWeight: '700',
  },
  testResult: {
    padding: `${spacing.xs} ${spacing.sm}`,
    border: '1px solid',
    borderRadius: radius.sm,
  },
  providerActions: {
    display: 'flex',
    gap: spacing.sm,
  },
  testBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.surfaceElevated,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  saveBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.accentDim,
    border: `1px solid ${colors.accent}40`,
    borderRadius: radius.sm,
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  removeBtn: {
    padding: `${spacing.xs} ${spacing.sm}`,
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  rowLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: '500',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  labelDesc: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  toggleRow: {
    display: 'flex',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflow: 'hidden',
    width: 'fit-content',
  },
  toggleBtn: {
    padding: `${spacing.sm} ${spacing.md}`,
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  toggleActive: {
    background: colors.surfaceElevated,
    color: colors.text,
    fontWeight: '500',
  },
  customList: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  customItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  customEditRow: {
    display: 'flex',
    gap: spacing.sm,
    width: '100%',
    alignItems: 'center',
  },
  customInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflow: 'hidden',
  },
  customName: {
    fontSize: typography.sizes.sm,
    fontWeight: '500',
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  customPrompt: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  customActions: {
    display: 'flex',
    gap: spacing.xs,
    flexShrink: 0,
  },
  editBtn: {
    padding: '2px 8px',
    background: 'none',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
  },
  doneEditBtn: {
    padding: `${spacing.xs} ${spacing.md}`,
    background: colors.accent,
    border: 'none',
    borderRadius: radius.sm,
    color: colors.textOnStrong,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: typography.fontFamily,
    flexShrink: 0,
  },
  addCustomRow: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'center',
  },
};
