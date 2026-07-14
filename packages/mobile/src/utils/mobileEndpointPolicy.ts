export type MobileEndpointRisk = {
  level: 'blocked';
  key: string;
};

function isLocalDeploymentHost(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '');
  return !hostname.includes('.')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === 'host.docker.internal'
    || hostname === '0.0.0.0'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.startsWith('fe80:')
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
    || /^10\./.test(hostname)
    || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

export function getMobileEndpointRisk(
  baseUrl: string,
  provider?: string,
): MobileEndpointRisk | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return provider === 'custom' || provider === 'qwen'
      ? { level: 'blocked', key: 'settings.apiConfig.endpointRisk.cloudBaseUrlRequired' }
      : null;
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
  if (parsed.username || parsed.password) {
    return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.querySecret' };
  }

  if (isLocalDeploymentHost(parsed.hostname)) {
    return { level: 'blocked', key: 'settings.apiConfig.endpointRisk.mobileCloudOnly' };
  }
  if (parsed.protocol !== 'https:') {
    return {
      level: 'blocked',
      key: parsed.protocol === 'http:'
        ? 'settings.apiConfig.endpointRisk.remoteHttp'
        : 'settings.apiConfig.endpointRisk.mobileCloudOnly',
    };
  }

  return null;
}
