type GenericPasswordOptions = {
  service?: string;
};

type Credentials = {
  username: string;
  password: string;
};

const PREFIX = 'albumdone.web.keychain.';
const memory = new Map<string, Credentials>();

function getKey(options?: GenericPasswordOptions): string {
  return `${PREFIX}${options?.service ?? 'default'}`;
}

export async function getGenericPassword(
  options?: GenericPasswordOptions,
): Promise<Credentials | false> {
  const key = getKey(options);
  const cached = memory.get(key);
  if (cached) {
    return cached;
  }

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as Credentials;
    if (typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      memory.set(key, parsed);
      return parsed;
    }
  } catch {
    // Ignore malformed preview storage.
  }

  return false;
}

export async function setGenericPassword(
  username: string,
  password: string,
  options?: GenericPasswordOptions,
): Promise<void> {
  const key = getKey(options);
  const credentials = { username, password };
  memory.set(key, credentials);
  try {
    localStorage.setItem(key, JSON.stringify(credentials));
  } catch {
    // Keep the in-memory value when browser storage is unavailable.
  }
}

export async function resetGenericPassword(
  options?: GenericPasswordOptions,
): Promise<void> {
  const key = getKey(options);
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in the web preview shell.
  }
}
