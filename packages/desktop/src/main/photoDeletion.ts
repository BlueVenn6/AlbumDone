import * as fs from 'fs';
import * as path from 'path';

export type PhotoDeletionMode = 'trash' | 'permanent';

// Paths must already have passed the IPC image/root allowlist validation.
export async function deletePhotoFiles(
  filePaths: string[],
  options: {
    mode: PhotoDeletionMode;
    trashItem: (filePath: string) => Promise<void>;
    purgeCache: (filePath: string) => Promise<number>;
  },
): Promise<{
  successCount: number;
  errors: string[];
  deletedPaths: string[];
  fallbackTrashPaths: string[];
  originalBytesRemoved: number;
  cacheBytesRemoved: number;
}> {
  const deletedPaths: string[] = [];
  const fallbackTrashPaths: string[] = [];
  const errors: string[] = [];
  let originalBytesRemoved = 0;
  let cacheBytesRemoved = 0;
  const uniquePaths = [...new Map(filePaths.map((filePath) => [
    process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath),
    filePath,
  ])).values()];
  for (const [index, filePath] of uniquePaths.entries()) {
    try {
      let size = 0;
      try {
        const stats = await fs.promises.lstat(filePath);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Deletion target is not a regular image file.');
        size = stats.size;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (size > 0 || fs.existsSync(filePath)) {
        if (options.mode === 'permanent') {
          await fs.promises.unlink(filePath);
        } else {
          try {
            await options.trashItem(filePath);
          } catch {
            const trashDir = path.join(path.dirname(filePath), '.photo-manager-trash');
            await fs.promises.mkdir(trashDir, { recursive: true });
            const destination = path.join(trashDir, `${Date.now()}_${index}_${path.basename(filePath)}`);
            await fs.promises.copyFile(filePath, destination, fs.constants.COPYFILE_EXCL);
            try {
              await fs.promises.unlink(filePath);
              fallbackTrashPaths.push(destination);
            } catch (err) {
              await fs.promises.unlink(destination);
              throw err;
            }
          }
        }
      }
      try {
        await fs.promises.lstat(filePath);
        throw new Error('File is still present after deletion.');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      deletedPaths.push(filePath);
      if (options.mode === 'permanent') originalBytesRemoved += size;
      try {
        cacheBytesRemoved += await options.purgeCache(filePath);
      } catch (err) {
        errors.push(`Generated cache cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      errors.push(`Failed to delete ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { successCount: deletedPaths.length, errors, deletedPaths, fallbackTrashPaths, originalBytesRemoved, cacheBytesRemoved };
}
