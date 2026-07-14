import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import type {
  GetPhotosParams,
  Include,
  PhotoIdentifier,
} from '@react-native-camera-roll/camera-roll';
import type { Photo } from '@photo-manager/shared';
import { detectScreenshotCandidate } from '@photo-manager/shared';

export type PhotoScanProgress = {
  albumId: string;
  loaded: number;
  page: number;
  hasMore: boolean;
};

export type ScanPhotoAlbumOptions = {
  albumId: string;
  pageSize?: number;
  fromTime?: number;
  toTime?: number;
  yieldEveryPages?: number;
  onProgress?: (progress: PhotoScanProgress) => void;
  onBatch?: (photos: Photo[], progress: PhotoScanProgress) => void;
  shouldCancel?: () => boolean;
};

export const PHOTO_LIBRARY_INCLUDE_FIELDS: Include[] = [
  'filename',
  'fileSize',
  'fileExtension',
  'imageSize',
  'albums',
  'sourceType',
];

const DEFAULT_SCAN_PAGE_SIZE = 200;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getUriBasename(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? uri;
  const basename = safeDecode(withoutQuery).split(/[\\/]/).pop();
  return basename && basename.trim() ? basename : '';
}

function normalizeExtension(extension: string | null | undefined): string | undefined {
  const normalized = (extension ?? '').replace(/^\./, '').trim().toLowerCase();
  return normalized || undefined;
}

function getFilename(edge: PhotoIdentifier): string {
  const image = edge.node.image;
  const extension = normalizeExtension(image.extension);
  const rawFilename = image.filename?.trim();
  if (rawFilename) {
    return rawFilename;
  }

  const uriBasename = getUriBasename(image.uri);
  if (uriBasename && /\.[a-z0-9]+$/i.test(uriBasename)) {
    return uriBasename;
  }

  const nodeId = String((edge.node as { id?: string }).id ?? '').trim();
  const stableName = nodeId || uriBasename || 'photo';
  return extension ? `${stableName}.${extension}` : stableName;
}

function getAlbumId(edge: PhotoIdentifier): string {
  const groupName = edge.node.group_name as unknown;
  if (Array.isArray(groupName)) {
    return groupName.filter(Boolean).join('/') || 'all';
  }
  if (typeof groupName === 'string' && groupName.trim()) {
    return groupName;
  }
  return 'all';
}

function getAlbumTags(edge: PhotoIdentifier): string[] {
  const tags = new Set<string>();
  const groupName = edge.node.group_name as unknown;
  if (Array.isArray(groupName)) {
    groupName.filter(Boolean).forEach((value) => tags.add(String(value)));
  } else if (typeof groupName === 'string' && groupName.trim()) {
    tags.add(groupName);
  }

  const sourceType = edge.node.sourceType;
  if (sourceType) {
    tags.add(sourceType);
  }

  const subtype = (edge.node as unknown as { subTypes?: string | string[] }).subTypes;
  if (Array.isArray(subtype)) {
    subtype.filter(Boolean).forEach((value) => tags.add(String(value)));
  } else if (typeof subtype === 'string' && subtype.trim()) {
    tags.add(subtype);
  }

  return [...tags];
}

export function convertCameraRollEdge(edge: PhotoIdentifier): Photo {
  const node = edge.node;
  const filename = getFilename(edge);
  const extension = normalizeExtension(node.image.extension)
    ?? normalizeExtension(filename.split('.').pop());
  const photo: Photo = {
    id: node.image.uri,
    uri: node.image.uri,
    filename,
    timestamp: node.timestamp * 1000,
    width: node.image.width ?? 0,
    height: node.image.height ?? 0,
    fileSize: node.image.fileSize ?? 0,
    isScreenshot: false,
    tags: getAlbumTags(edge),
    albumId: getAlbumId(edge),
    ...(node.image.filepath ? { path: node.image.filepath } : {}),
    ...(extension ? { extension } : {}),
  };

  const screenshot = detectScreenshotCandidate({
    filename: photo.filename,
    width: photo.width,
    height: photo.height,
    uri: photo.uri,
    filePath: photo.path,
    albumId: photo.albumId,
    fileSize: photo.fileSize,
    extension: photo.extension,
    tags: photo.tags,
  });

  photo.isScreenshot = screenshot.isScreenshot;
  photo.screenshotConfidence = screenshot.confidence;
  photo.screenshotReasons = screenshot.reasons;
  return photo;
}

export function buildPhotoFetchParams(
  albumId: string,
  options: {
    first?: number | undefined;
    after?: string | undefined;
    fromTime?: number | undefined;
    toTime?: number | undefined;
  } = {},
): GetPhotosParams {
  const params: GetPhotosParams = {
    first: options.first ?? DEFAULT_SCAN_PAGE_SIZE,
    assetType: 'Photos',
    include: PHOTO_LIBRARY_INCLUDE_FIELDS,
    groupTypes: albumId === '__all__' ? 'All' : 'Album',
    ...(albumId === '__all__' ? {} : { groupName: albumId }),
  };

  if (options.after) {
    params.after = options.after;
  }
  if (typeof options.fromTime === 'number') {
    params.fromTime = options.fromTime;
  }
  if (typeof options.toTime === 'number') {
    params.toTime = options.toTime;
  }

  return params;
}

function normalizeAlbumName(value: string): string {
  return value.trim().toLowerCase();
}

export function shouldKeepPhotoForAlbum(photo: Photo, albumId: string): boolean {
  if (albumId === '__all__') {
    return true;
  }

  const hints = [photo.albumId, ...(photo.tags ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeAlbumName)
    .filter((value) => value !== 'all');

  if (hints.length === 0) {
    return true;
  }

  const requestedAlbum = normalizeAlbumName(albumId);
  return hints.some((hint) => hint === requestedAlbum);
}

export async function scanPhotoAlbum({
  albumId,
  pageSize = DEFAULT_SCAN_PAGE_SIZE,
  fromTime,
  toTime,
  yieldEveryPages = 1,
  onProgress,
  onBatch,
  shouldCancel,
}: ScanPhotoAlbumOptions): Promise<Photo[]> {
  const photosById = new Map<string, Photo>();
  const seenCursors = new Set<string>();
  let after: string | undefined;
  let hasMore = true;
  let page = 0;

  while (hasMore) {
    if (shouldCancel?.()) {
      break;
    }

    page += 1;
    const result = await CameraRoll.getPhotos(buildPhotoFetchParams(albumId, {
      first: pageSize,
      after,
      fromTime,
      toTime,
    }));

    const pagePhotos: Photo[] = [];
    for (const edge of result.edges) {
      const photo = convertCameraRollEdge(edge);
      if (!shouldKeepPhotoForAlbum(photo, albumId)) {
        continue;
      }
      if (!photosById.has(photo.id)) {
        photosById.set(photo.id, photo);
        pagePhotos.push(photo);
      }
    }

    hasMore = result.page_info.has_next_page;
    after = result.page_info.end_cursor;
    const progress = {
      albumId,
      loaded: photosById.size,
      page,
      hasMore,
    };
    onProgress?.(progress);
    onBatch?.(pagePhotos, progress);

    if (!hasMore) {
      break;
    }
    if (!after || seenCursors.has(after)) {
      break;
    }
    seenCursors.add(after);

    if (yieldEveryPages > 0 && page % yieldEveryPages === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return [...photosById.values()].sort((a, b) => b.timestamp - a.timestamp);
}
