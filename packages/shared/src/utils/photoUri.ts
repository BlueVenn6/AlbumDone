const LOCAL_FILE_PREFIX = 'local-file:///';
const LEGACY_LOCAL_PHOTO_PREFIX = 'local-photo:///';

function encodePathForUri(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeUriPath(value: string): string {
  const decoded = decodeURIComponent(value);
  if (/^\/[a-zA-Z]:\//.test(decoded)) {
    return decoded.slice(1).replace(/\//g, '\\');
  }
  if (/^[a-zA-Z]:\//.test(decoded)) {
    return decoded.replace(/\//g, '\\');
  }
  return decoded;
}

export function pathToLocalFileUri(filePath: string): string {
  return `${LOCAL_FILE_PREFIX}${encodePathForUri(filePath)}`;
}

export function localFileUriToPath(uriOrPath: string): string {
  if (uriOrPath.startsWith(LOCAL_FILE_PREFIX)) {
    return decodeUriPath(uriOrPath.slice(LOCAL_FILE_PREFIX.length));
  }

  if (uriOrPath.startsWith(LEGACY_LOCAL_PHOTO_PREFIX)) {
    return decodeUriPath(uriOrPath.slice(LEGACY_LOCAL_PHOTO_PREFIX.length));
  }

  return uriOrPath;
}

export function normalizePhotoUri(uriOrPath: string): string {
  return pathToLocalFileUri(localFileUriToPath(uriOrPath));
}

export function isLocalPhotoUri(value: string): boolean {
  return value.startsWith(LOCAL_FILE_PREFIX) || value.startsWith(LEGACY_LOCAL_PHOTO_PREFIX);
}
