export type ParsedHttpUrl = {
  origin: string;
  pathname: string;
  search: string;
  hostname: string;
};

export function trimTrailingSlashes(value: string): string {
  const trimmed = value.trim();
  let endIndex = trimmed.length;
  while (endIndex > 0 && trimmed.charCodeAt(endIndex - 1) === 47) {
    endIndex -= 1;
  }
  return trimmed.slice(0, endIndex);
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

  const schemeEndIndex = trimmed.indexOf('://');
  if (schemeEndIndex <= 0) {
    return null;
  }

  const protocol = trimmed.slice(0, schemeEndIndex).toLowerCase();
  if (!['http', 'https'].includes(protocol)) {
    return null;
  }

  const authorityStartIndex = schemeEndIndex + 3;
  let authorityEndIndex = trimmed.length;
  for (let index = authorityStartIndex; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '/' || character === '?' || character === '#') {
      authorityEndIndex = index;
      break;
    }
    if (!character || character <= ' ' || '"<>\\^`{|}'.includes(character)) {
      return null;
    }
  }

  const authority = trimmed.slice(authorityStartIndex, authorityEndIndex);
  if (!authority) {
    return null;
  }

  const hostname = getHostnameFromAuthority(authority);
  if (!hostname) {
    return null;
  }

  const fragmentIndex = trimmed.indexOf('#', authorityEndIndex);
  const contentEndIndex = fragmentIndex >= 0 ? fragmentIndex : trimmed.length;
  const queryIndex = trimmed.indexOf('?', authorityEndIndex);
  const hasQuery = queryIndex >= 0 && queryIndex < contentEndIndex;
  const pathEndIndex = hasQuery ? queryIndex : contentEndIndex;
  const rawPathname = authorityEndIndex < pathEndIndex
    ? trimmed.slice(authorityEndIndex, pathEndIndex)
    : '';

  return {
    origin: `${protocol}://${authority}`,
    pathname: rawPathname || '/',
    search: hasQuery ? trimmed.slice(queryIndex, contentEndIndex) : '',
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
