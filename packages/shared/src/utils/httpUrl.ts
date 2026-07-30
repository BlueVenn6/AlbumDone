export type ParsedHttpUrl = {
  origin: string;
  pathname: string;
  search: string;
  hostname: string;
};

const HTTP_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?(?:#.*)?$/i;

export function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getHostnameFromAuthority(authority: string): string {
  const withoutCredentials = authority.split('@').pop() ?? authority;
  if (withoutCredentials.startsWith('[')) {
    const endIndex = withoutCredentials.indexOf(']');
    return endIndex >= 0
      ? withoutCredentials.slice(1, endIndex).toLowerCase()
      : withoutCredentials.toLowerCase();
  }
  return withoutCredentials.split(':')[0]?.toLowerCase() ?? '';
}

export function parseHttpUrl(rawUrl: string): ParsedHttpUrl | null {
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
  if (!protocol || !authority || !['http', 'https'].includes(protocol)) {
    return null;
  }

  const hostname = getHostnameFromAuthority(authority);
  if (!hostname) {
    return null;
  }

  return {
    origin: `${protocol}://${authority}`,
    pathname: match[3] || '/',
    search: match[4] || '',
    hostname,
  };
}

export function parseHttpUrlOrThrow(rawUrl: string): ParsedHttpUrl {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    throw new Error('Base URL is invalid. Enter a full URL, for example https://api.example.com/v1.');
  }
  return parsed;
}

export function getHttpUrlHostname(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  return parseHttpUrl(rawUrl)?.hostname ?? null;
}
