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

function hasInvalidAuthorityCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (
      characterCode <= 32
      || characterCode === 34
      || characterCode === 35
      || characterCode === 47
      || characterCode === 60
      || characterCode === 62
      || characterCode === 63
      || characterCode === 92
      || characterCode === 94
      || characterCode === 96
      || characterCode === 123
      || characterCode === 124
      || characterCode === 125
      || characterCode === 127
    ) {
      return true;
    }
  }
  return false;
}

function isValidPort(value: string): boolean {
  if (!value) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode < 48 || characterCode > 57) {
      return false;
    }
  }
  const port = Number(value);
  return port <= 65535;
}

function parseAuthority(authority: string): { hostname: string; hostAndPort: string } | null {
  if (!authority || hasInvalidAuthorityCharacter(authority)) {
    return null;
  }

  const credentialsEnd = authority.lastIndexOf('@');
  const hostAndPort = authority.slice(credentialsEnd + 1);
  if (!hostAndPort) {
    return null;
  }

  if (hostAndPort.startsWith('[')) {
    const closingBracket = hostAndPort.indexOf(']');
    if (closingBracket <= 1) {
      return null;
    }
    const hostname = hostAndPort.slice(1, closingBracket).toLowerCase();
    const portSuffix = hostAndPort.slice(closingBracket + 1);
    if (portSuffix && (!portSuffix.startsWith(':') || !isValidPort(portSuffix.slice(1)))) {
      return null;
    }
    return {
      hostname,
      hostAndPort: `[${hostname}]${portSuffix}`,
    };
  }

  const portSeparator = hostAndPort.lastIndexOf(':');
  const hasPort = portSeparator >= 0;
  const hostname = (hasPort ? hostAndPort.slice(0, portSeparator) : hostAndPort).toLowerCase();
  if (!hostname || hostname.includes(':')) {
    return null;
  }
  const portSuffix = hasPort ? hostAndPort.slice(portSeparator) : '';
  if (hasPort && !isValidPort(portSuffix.slice(1))) {
    return null;
  }
  return {
    hostname,
    hostAndPort: `${hostname}${portSuffix}`,
  };
}

export function parseHttpUrl(rawUrl: string): ParsedHttpUrl | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd < 0) {
    return null;
  }

  const protocol = trimmed.slice(0, schemeEnd).toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') {
    return null;
  }

  const authorityStart = schemeEnd + 3;
  let authorityEnd = authorityStart;
  while (authorityEnd < trimmed.length) {
    const character = trimmed.charCodeAt(authorityEnd);
    if (character === 35 || character === 47 || character === 63) {
      break;
    }
    authorityEnd += 1;
  }

  const authority = parseAuthority(trimmed.slice(authorityStart, authorityEnd));
  if (!authority) {
    return null;
  }

  let cursor = authorityEnd;
  let pathname = '/';
  if (trimmed.charCodeAt(cursor) === 47) {
    const pathStart = cursor;
    while (cursor < trimmed.length) {
      const character = trimmed.charCodeAt(cursor);
      if (character === 35 || character === 63) {
        break;
      }
      cursor += 1;
    }
    pathname = trimmed.slice(pathStart, cursor);
  }

  let search = '';
  if (trimmed.charCodeAt(cursor) === 63) {
    const searchStart = cursor;
    while (cursor < trimmed.length && trimmed.charCodeAt(cursor) !== 35) {
      cursor += 1;
    }
    search = trimmed.slice(searchStart, cursor);
  }

  return {
    origin: `${protocol}://${authority.hostAndPort}`,
    pathname,
    search,
    hostname: authority.hostname,
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
