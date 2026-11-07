// Album progress shares the existing local SQLite task store. It uses separate
// versioned keys so completing a batch never erases the album's progress.
export const taskProgressStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!window.electronAPI) throw new Error('Local task storage is unavailable.');
    return window.electronAPI.tasks.getCheckpoint(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!window.electronAPI) throw new Error('Local task storage is unavailable.');
    await window.electronAPI.tasks.saveCheckpoint(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (!window.electronAPI) throw new Error('Local task storage is unavailable.');
    await window.electronAPI.tasks.deleteCheckpoint(key);
  },
};
