import * as path from 'path';

const allowedLocalFileRoots = new Set<string>();

function normalizeForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(
    normalizeForCompare(parentPath),
    normalizeForCompare(childPath),
  );
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function addAllowedLocalFileRoot(rootPath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  allowedLocalFileRoots.add(resolvedRoot);
  return resolvedRoot;
}

export function assertAllowedLocalFilePath(filePath: string, action: string): string {
  const resolvedPath = path.resolve(filePath);
  for (const root of allowedLocalFileRoots) {
    if (isInsidePath(resolvedPath, root)) {
      return resolvedPath;
    }
  }

  throw new Error(`${action} is outside the allowed local file roots.`);
}
