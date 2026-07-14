export type PhotoQuality = {
  sharpness: number; // Laplacian variance score
  exposure: 'normal' | 'overexposed' | 'underexposed';
  noise: number; // 0-1 noise level
  hasFace: boolean;
  faceScore: number; // eyes open, unobstructed
  compositionScore: number; // subject centering / rule of thirds
  timestamp: number;
};

export type Photo = {
  id: string;
  uri: string;
  filename: string;
  timestamp: number;
  width: number;
  height: number;
  fileSize: number;
  isScreenshot: boolean;
  path?: string;
  extension?: string;
  thumbnailUri?: string;
  fingerprint?: string;
  contentHash?: string;
  visualHash?: string;
  screenshotConfidence?: number;
  screenshotReasons?: string[];
  quality?: PhotoQuality;
  tags: string[];
  albumId: string;
};

export type Album = {
  id: string;
  title: string;
  count: number;
  countIsExact?: boolean;
  totalBytes?: number;
  coverUri?: string;
};

export type DuplicateGroup = {
  id: string;
  photos: Photo[];
  selectedPhotoId: string; // recommended photo to keep
  rejectedPhotoIds?: string[]; // explicitly selected deletion IDs; empty means review only
  confidence?: 'high' | 'possible';
  reason: string; // why the default selection was made
};

export type CullingDecision = 'keep' | 'delete' | 'pending';

export type CullingItem = {
  photo: Photo;
  decision: CullingDecision;
  aiDecision: CullingDecision; // AI pre-processing result
};
