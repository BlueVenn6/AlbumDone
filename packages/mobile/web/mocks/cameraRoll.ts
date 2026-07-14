type AssetType = 'Photos' | 'Videos' | 'All';
type GroupTypes = 'All' | 'Album';

type GetAlbumsOptions = {
  assetType?: AssetType;
};

type GetPhotosParams = {
  first: number;
  after?: string;
  groupName?: string;
  groupTypes?: GroupTypes;
  assetType?: AssetType;
  include?: string[];
  fromTime?: number;
  toTime?: number;
};

type SaveOptions = {
  type?: 'photo' | 'video' | 'auto';
  album?: string;
};

type LocalFolderImportResult = {
  albumId: string | null;
  count: number;
  cancelled?: boolean;
};

type MockPhoto = {
  uri: string;
  filename: string;
  timestamp: number;
  width: number;
  height: number;
  fileSize: number;
  group_name: string;
};

const NO_READABLE_PHOTOS = 'NO_READABLE_PHOTOS';
const importedObjectUrls = new Set<string>();
const readableImageExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

const previewImages = [
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520975922203-b6d6311d5891?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1517816428104-797678c7cf0c?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1519682577862-22b62b24e493?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516738901171-8eb4fc13bd20?auto=format&fit=crop&w=900&q=80',
];

const screenshotSvgs = [
  ['#111827', '#f9fafb', '#38bdf8'],
  ['#f8fafc', '#0f172a', '#22c55e'],
  ['#1f2937', '#fef3c7', '#f59e0b'],
  ['#0f172a', '#e0f2fe', '#a78bfa'],
] as const;

function toSvgDataUri(index: number, title: string): string {
  const palette = screenshotSvgs[index % screenshotSvgs.length]!;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960">
      <rect width="540" height="960" rx="44" fill="${palette[0]}"/>
      <rect x="42" y="72" width="456" height="86" rx="24" fill="${palette[2]}"/>
      <rect x="42" y="196" width="456" height="88" rx="22" fill="${palette[1]}" opacity="0.92"/>
      <rect x="42" y="310" width="330" height="34" rx="17" fill="${palette[1]}" opacity="0.74"/>
      <rect x="42" y="366" width="408" height="34" rx="17" fill="${palette[1]}" opacity="0.58"/>
      <rect x="42" y="458" width="456" height="210" rx="28" fill="${palette[1]}" opacity="0.18"/>
      <rect x="72" y="492" width="270" height="28" rx="14" fill="${palette[1]}" opacity="0.88"/>
      <rect x="72" y="542" width="354" height="28" rx="14" fill="${palette[1]}" opacity="0.56"/>
      <rect x="72" y="592" width="228" height="28" rx="14" fill="${palette[1]}" opacity="0.56"/>
      <text x="270" y="122" text-anchor="middle" font-family="Arial" font-size="30" font-weight="700" fill="${palette[1]}">${title}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function monthTimestamp(monthOffset: number, day: number): number {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth() - monthOffset,
    day,
    10 + (day % 8),
    15,
  ).getTime() / 1000;
}

function buildPhoto(
  index: number,
  album: string,
  options: Partial<MockPhoto> = {},
): MockPhoto {
  const width = options.width ?? (index % 4 === 0 ? 4032 : 3024);
  const height = options.height ?? (index % 4 === 0 ? 3024 : 4032);
  const timestamp = options.timestamp ?? monthTimestamp(index % 12, (index % 25) + 1);
  const filename = options.filename ?? `IMG_${String(4100 + index).padStart(4, '0')}.jpg`;
  const uri = options.uri ?? `${previewImages[index % previewImages.length]}&sig=${index}`;

  return {
    uri,
    filename,
    timestamp,
    width,
    height,
    fileSize: options.fileSize ?? 2_400_000 + index * 37_000,
    group_name: album,
  };
}

function createInitialLibrary(): MockPhoto[] {
  const photos: MockPhoto[] = [];

  for (let index = 0; index < 72; index += 1) {
    photos.push(buildPhoto(index, index % 3 === 0 ? 'Camera' : 'Family'));
  }

  const duplicateUri = `${previewImages[2]}&duplicate=exact`;
  photos.push(buildPhoto(200, 'Camera', {
    uri: duplicateUri,
    filename: 'IMG_8888.jpg',
    timestamp: monthTimestamp(1, 11),
    width: 4032,
    height: 3024,
    fileSize: 3_200_000,
  }));
  photos.push(buildPhoto(201, 'Camera', {
    uri: duplicateUri,
    filename: 'IMG_8888 copy.jpg',
    timestamp: monthTimestamp(1, 11) + 3,
    width: 4032,
    height: 3024,
    fileSize: 3_198_000,
  }));
  photos.push(buildPhoto(202, 'Camera', {
    uri: `${previewImages[2]}&duplicate=near`,
    filename: 'IMG_8889.jpg',
    timestamp: monthTimestamp(1, 11) + 8,
    width: 4010,
    height: 3008,
    fileSize: 3_050_000,
  }));

  for (let index = 0; index < 16; index += 1) {
    photos.push(buildPhoto(300 + index, 'Screenshots', {
      uri: toSvgDataUri(index, index % 2 === 0 ? 'Screenshot' : '截圖'),
      filename: index % 2 === 0
        ? `Screenshot_2026-06-${String(index + 1).padStart(2, '0')}.png`
        : `截圖_2026-06-${String(index + 1).padStart(2, '0')}.png`,
      timestamp: monthTimestamp(index % 6, (index % 25) + 1),
      width: 1170,
      height: 2532,
      fileSize: 880_000 + index * 14_000,
    }));
  }

  return photos.sort((a, b) => b.timestamp - a.timestamp);
}

let library = createInitialLibrary();

function getRelativeFolderName(file: File): string {
  const relativePath = 'webkitRelativePath' in file
    ? String(file.webkitRelativePath)
    : '';
  const firstSegment = relativePath.split(/[\\/]/).find(Boolean);
  return firstSegment ?? 'Local Import';
}

function isCandidateImage(file: File): boolean {
  return file.type.startsWith('image/') || readableImageExtensionPattern.test(file.name);
}

function readImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error(NO_READABLE_PHOTOS));
    image.src = uri;
  });
}

function pickLocalImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';

    const cleanup = (files: File[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      cleanup(Array.from(input.files ?? []).filter(isCandidateImage));
    }, { once: true });
    input.addEventListener('cancel', () => {
      cleanup([]);
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function fileToMockPhoto(file: File): Promise<MockPhoto | null> {
  const uri = URL.createObjectURL(file);
  importedObjectUrls.add(uri);

  try {
    const { width, height } = await readImageSize(uri);
    return {
      uri,
      filename: file.name,
      timestamp: (file.lastModified || Date.now()) / 1000,
      width,
      height,
      fileSize: file.size,
      group_name: getRelativeFolderName(file),
    };
  } catch {
    importedObjectUrls.delete(uri);
    URL.revokeObjectURL(uri);
    return null;
  }
}

async function importLocalFolder(): Promise<LocalFolderImportResult> {
  const files = await pickLocalImageFiles();
  if (files.length === 0) {
    return { albumId: null, count: 0, cancelled: true };
  }

  const imported = (await Promise.all(
    files.map((file) => fileToMockPhoto(file)),
  )).filter((photo): photo is MockPhoto => photo !== null);

  if (imported.length === 0) {
    throw new Error(NO_READABLE_PHOTOS);
  }

  const albumId = imported[0]?.group_name ?? 'Local Import';
  library = [...imported, ...library].sort((a, b) => b.timestamp - a.timestamp);

  return {
    albumId,
    count: imported.length,
  };
}

function getAlbumPhotos(albumName?: string): MockPhoto[] {
  if (!albumName || albumName === '__all__') {
    return library;
  }
  return library.filter((photo) => photo.group_name === albumName);
}

function filterByTime(photos: MockPhoto[], params: GetPhotosParams): MockPhoto[] {
  const fromTime = typeof params.fromTime === 'number' ? params.fromTime / 1000 : null;
  const toTime = typeof params.toTime === 'number' ? params.toTime / 1000 : null;

  return photos.filter((photo) => {
    if (fromTime !== null && photo.timestamp < fromTime) {
      return false;
    }
    if (toTime !== null && photo.timestamp > toTime) {
      return false;
    }
    return true;
  });
}

export const CameraRoll = {
  getAlbums: async (_options?: GetAlbumsOptions) => {
    const counts = new Map<string, number>();
    for (const photo of library) {
      counts.set(photo.group_name, (counts.get(photo.group_name) ?? 0) + 1);
    }

    return [...counts.entries()].map(([title, count]) => ({ title, count }));
  },

  getPhotos: async (params: GetPhotosParams) => {
    const first = Math.max(1, params.first ?? 100);
    const start = params.after ? Number.parseInt(params.after, 10) : 0;
    const albumName =
      params.groupTypes === 'Album' ? params.groupName : undefined;
    const photos = filterByTime(getAlbumPhotos(albumName), params);
    const page = photos.slice(start, start + first);
    const next = start + page.length;

    return {
      edges: page.map((photo) => ({
        node: {
          type: 'image',
          group_name: photo.group_name,
          timestamp: photo.timestamp,
          image: {
            uri: photo.uri,
            filename: photo.filename,
            width: photo.width,
            height: photo.height,
            fileSize: photo.fileSize,
          },
        },
      })),
      page_info: {
        has_next_page: next < photos.length,
        end_cursor: String(next),
      },
    };
  },

  deletePhotos: async (uris: string[]) => {
    const deleteSet = new Set(uris);
    library = library.filter((photo) => !deleteSet.has(photo.uri));
    for (const uri of uris) {
      if (importedObjectUrls.delete(uri)) {
        URL.revokeObjectURL(uri);
      }
    }
    return true;
  },

  save: async (uri: string, options?: SaveOptions) => {
    const albumName = options?.album ?? 'AlbumDone';
    library.unshift(buildPhoto(Date.now() % 100000, albumName, {
      uri,
      filename: `AlbumDone_${Date.now()}.jpg`,
      timestamp: Date.now() / 1000,
      width: 1200,
      height: 1200,
      fileSize: 500_000,
    }));
    return uri;
  },

  importLocalFolder,
};

export default CameraRoll;
