import type { StateStorage } from 'zustand/middleware';

const memoryStore = new Map<string, string>();

const memoryStorage: StateStorage = {
  getItem: (name) => memoryStore.get(name) ?? null,
  setItem: (name, value) => {
    memoryStore.set(name, value);
  },
  removeItem: (name) => {
    memoryStore.delete(name);
  },
};

export function getSettingsStorage(): StateStorage {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }

  return memoryStorage;
}
