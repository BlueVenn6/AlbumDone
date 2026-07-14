import type { TFunction } from 'i18next';

const SYSTEM_ALBUM_KEY_BY_NAME: Record<string, string> = {
  all: 'common.systemFolders.allPhotos',
  allphotos: 'common.systemFolders.allPhotos',
  allitems: 'common.systemFolders.allPhotos',
  animated: 'common.systemFolders.animated',
  animations: 'common.systemFolders.animated',
  bursts: 'common.systemFolders.bursts',
  burst: 'common.systemFolders.bursts',
  camera: 'common.systemFolders.camera',
  cameraroll: 'common.systemFolders.cameraRoll',
  dcim: 'common.systemFolders.cameraRoll',
  desktop: 'common.systemFolders.desktop',
  documents: 'common.systemFolders.documents',
  documentsfolder: 'common.systemFolders.documents',
  downloads: 'common.systemFolders.downloads',
  downloadsfolder: 'common.systemFolders.downloads',
  favorites: 'common.systemFolders.favorites',
  favourites: 'common.systemFolders.favorites',
  family: 'common.systemFolders.family',
  hidden: 'common.systemFolders.hidden',
  imports: 'common.systemFolders.imports',
  imported: 'common.systemFolders.imports',
  library: 'common.systemFolders.library',
  livephotos: 'common.systemFolders.livePhotos',
  panorama: 'common.systemFolders.panoramas',
  panoramas: 'common.systemFolders.panoramas',
  photos: 'common.systemFolders.photos',
  portrait: 'common.systemFolders.portraits',
  portraits: 'common.systemFolders.portraits',
  pictures: 'common.systemFolders.pictures',
  picturesfolder: 'common.systemFolders.pictures',
  recents: 'common.systemFolders.recents',
  recent: 'common.systemFolders.recents',
  recentlyadded: 'common.systemFolders.recentlyAdded',
  recentlydeleted: 'common.systemFolders.recentlyDeleted',
  screenshots: 'common.systemFolders.screenshots',
  screenrecording: 'common.systemFolders.screenRecordings',
  screenrecordings: 'common.systemFolders.screenRecordings',
  selfies: 'common.systemFolders.selfies',
  selfie: 'common.systemFolders.selfies',
  slomo: 'common.systemFolders.sloMo',
  slowmotion: 'common.systemFolders.sloMo',
  timelapse: 'common.systemFolders.timeLapse',
  videos: 'common.systemFolders.videos',
  videosfolder: 'common.systemFolders.videos',
};

function normalizeSystemAlbumName(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

export function getLocalizedAlbumTitle(title: string, t: TFunction): string {
  const key = SYSTEM_ALBUM_KEY_BY_NAME[normalizeSystemAlbumName(title)];
  return key ? t(key) : title;
}
