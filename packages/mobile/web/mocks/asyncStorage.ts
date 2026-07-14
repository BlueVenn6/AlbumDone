const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory value when browser storage is unavailable.
  }
}

function remove(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in the web preview shell.
  }
}

const AsyncStorage = {
  getItem: async (key: string) => read(key),
  setItem: async (key: string, value: string) => write(key, value),
  removeItem: async (key: string) => remove(key),
  clear: async () => {
    memory.clear();
    try {
      localStorage.clear();
    } catch {
      // Ignore storage failures in the web preview shell.
    }
  },
};

export default AsyncStorage;
