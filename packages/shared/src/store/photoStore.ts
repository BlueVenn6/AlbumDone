import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Photo, Album, DuplicateGroup } from '../types';
import { groupSimilarPhotosAsync } from '../utils/deduplication';
import { detectScreenshots } from '../utils/screenshotDetector';

export interface PhotoState {
  albums: Album[];
  selectedAlbumId: string | null;
  photos: Photo[];
  duplicateGroups: DuplicateGroup[];
  pendingDeletion: Photo[];
  dedupeProgress: number;
  dedupeStatus: string;
  isLoading: boolean;
  error: string | null;

  // Actions
  setAlbums: (albums: Album[]) => void;
  setSelectedAlbum: (albumId: string | null) => void;
  loadPhotos: (photos: Photo[]) => void;
  addPhotos: (photos: Photo[]) => void;
  runDeduplication: (options?: {
    photoIds?: string[];
    onProgress?: (progress: number, status: string) => void;
  }) => Promise<void>;
  cancelDeduplication: () => void;
  toggleDuplicateSelection: (groupId: string, photoId: string) => void;
  confirmDeduplication: () => Photo[];
  markForDeletion: (photoIds: string[]) => void;
  removePhotosById: (photoIds: string[]) => void;
  restoreFromDeletion: (photoId: string) => void;
  clearPendingDeletion: () => void;
  updatePhotoTags: (photoId: string, tags: string[]) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  albums: [] as Album[],
  selectedAlbumId: null as string | null,
  photos: [] as Photo[],
  duplicateGroups: [] as DuplicateGroup[],
  pendingDeletion: [] as Photo[],
  dedupeProgress: 0,
  dedupeStatus: '',
  isLoading: false,
  error: null as string | null,
};

let activeDedupeRun = 0;

export const usePhotoStore = create<PhotoState>()(
  immer((set, get) => ({
    ...initialState,

    setAlbums: (albums) =>
      set((state) => {
        state.albums = albums;
      }),

    setSelectedAlbum: (albumId) =>
      set((state) => {
        state.selectedAlbumId = albumId;
        // Clear photos when switching albums
        state.photos = [];
        state.duplicateGroups = [];
        state.pendingDeletion = [];
        state.dedupeProgress = 0;
        state.dedupeStatus = '';
      }),

    loadPhotos: (photos) =>
      set((state) => {
        state.photos = detectScreenshots(photos);
        state.duplicateGroups = [];
        state.pendingDeletion = [];
        state.dedupeProgress = 0;
        state.dedupeStatus = '';
        state.isLoading = false;
        state.error = null;
      }),

    addPhotos: (photos) =>
      set((state) => {
        const existingIds = new Set(state.photos.map((p) => p.id));
        const newPhotos = detectScreenshots(photos.filter((p) => !existingIds.has(p.id)));
        state.photos.push(...newPhotos);
      }),

    runDeduplication: async (options = {}) => {
      const { photos } = get();
      const selectedIds = options.photoIds ? new Set(options.photoIds) : null;
      const taskPhotos = selectedIds
        ? photos.filter((photo) => selectedIds.has(photo.id))
        : photos;
      const runId = ++activeDedupeRun;

      set({
        isLoading: true,
        dedupeProgress: 0,
        dedupeStatus: 'dedup.status.analyzing',
        duplicateGroups: [],
        error: null,
      });

      try {
        const total = taskPhotos.length;

        options.onProgress?.(5, `dedup.status.analyzingTotal:${total}`);
        set({
          dedupeProgress: 5,
          dedupeStatus: `dedup.status.analyzingTotal:${total}`,
        });

        const sortedPhotos = [...taskPhotos].sort((a, b) => a.timestamp - b.timestamp);
        const groups = await groupSimilarPhotosAsync(sortedPhotos, {
          shouldCancel: () => runId !== activeDedupeRun,
          onProgress: ({ stage, processed, total: comparisons }) => {
            if (stage === 'exact') {
              return;
            }
            const progress = Math.min(98, Math.round(5 + (processed / Math.max(1, comparisons)) * 93));
            const status = `dedup.status.analyzingProgress:${processed}:${comparisons}`;
            options.onProgress?.(progress, status);
            set({ dedupeProgress: progress, dedupeStatus: status });
          },
        });
        if (runId !== activeDedupeRun) {
          return;
        }

        options.onProgress?.(100, `dedup.status.found:${groups.length}`);
        set({
          duplicateGroups: groups,
          dedupeProgress: 100,
          dedupeStatus: `dedup.status.found:${groups.length}`,
          isLoading: false,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          set((state) => {
            state.isLoading = false;
            state.dedupeStatus = 'dedup.status.cancelled';
          });
          return;
        }
        const message = err instanceof Error ? err.message : 'dedup.status.failed';
        set((state) => {
          state.error = message;
          state.isLoading = false;
          state.dedupeProgress = 0;
          state.dedupeStatus = '';
        });
      }
    },

    cancelDeduplication: () => {
      activeDedupeRun += 1;
      set((state) => {
        state.isLoading = false;
        state.dedupeStatus = 'dedup.status.cancelled';
      });
    },

    toggleDuplicateSelection: (groupId, photoId) =>
      set((state) => {
        const group = state.duplicateGroups.find((g) => g.id === groupId);
        if (!group) return;

        const targetPhoto = group.photos.find((photo) => photo.id === photoId);
        if (!targetPhoto) {
          return;
        }

        const currentRejectedPhotoIds = group.rejectedPhotoIds
          ?? group.photos
            .filter((photo) => photo.id !== group.selectedPhotoId)
            .map((photo) => photo.id);
        const rejectedSet = new Set(currentRejectedPhotoIds);

        if (rejectedSet.has(photoId)) {
          rejectedSet.delete(photoId);
        } else {
          const keepCount = group.photos.length - rejectedSet.size;
          if (keepCount <= 1) {
            return;
          }
          rejectedSet.add(photoId);
        }

        if (rejectedSet.has(group.selectedPhotoId)) {
          const nextKeptPhoto = group.photos.find((photo) => !rejectedSet.has(photo.id));
          if (nextKeptPhoto) {
            group.selectedPhotoId = nextKeptPhoto.id;
          }
        }

        group.rejectedPhotoIds = [...rejectedSet];
        group.reason = 'manual-selection';
      }),

    confirmDeduplication: () => {
      const { duplicateGroups } = get();
      const toDelete: Photo[] = [];

      for (const group of duplicateGroups) {
        const rejectedPhotoIds = group.rejectedPhotoIds
          ?? group.photos
            .filter((photo) => photo.id !== group.selectedPhotoId)
            .map((photo) => photo.id);
        const rejectedSet = new Set(rejectedPhotoIds);
        const losers = group.photos.filter((photo) => rejectedSet.has(photo.id));
        toDelete.push(...losers);
      }

      set((state) => {
        const deleteIds = new Set(toDelete.map((p) => p.id));
        state.photos = state.photos.filter((p) => !deleteIds.has(p.id));
        state.pendingDeletion = toDelete;
        state.duplicateGroups = [];
      });

      return toDelete;
    },

    markForDeletion: (photoIds) =>
      set((state) => {
        const deleteSet = new Set(photoIds);
        const toDelete = state.photos.filter((p) => deleteSet.has(p.id));
        state.pendingDeletion.push(...toDelete.filter(
          (p) => !state.pendingDeletion.some((d) => d.id === p.id)
        ));
      }),

    removePhotosById: (photoIds) =>
      set((state) => {
        const deleteSet = new Set(photoIds);
        if (deleteSet.size === 0) {
          return;
        }
        state.photos = state.photos.filter((p) => !deleteSet.has(p.id));
        state.pendingDeletion = state.pendingDeletion.filter((p) => !deleteSet.has(p.id));
        for (const group of state.duplicateGroups) {
          group.photos = group.photos.filter((photo) => !deleteSet.has(photo.id));
          const rejectedPhotoIds = group.rejectedPhotoIds?.filter((photoId) => !deleteSet.has(photoId));
          if (rejectedPhotoIds && rejectedPhotoIds.length > 0) {
            group.rejectedPhotoIds = rejectedPhotoIds;
          } else {
            delete group.rejectedPhotoIds;
          }
          if (deleteSet.has(group.selectedPhotoId)) {
            group.selectedPhotoId = group.photos[0]?.id ?? group.selectedPhotoId;
          }
        }
        state.duplicateGroups = state.duplicateGroups.filter((group) => group.photos.length > 1);
      }),

    restoreFromDeletion: (photoId) =>
      set((state) => {
        state.pendingDeletion = state.pendingDeletion.filter((p) => p.id !== photoId);
      }),

    clearPendingDeletion: () =>
      set((state) => {
        state.pendingDeletion = [];
      }),

    updatePhotoTags: (photoId, tags) =>
      set((state) => {
        const photo = state.photos.find((p) => p.id === photoId);
        if (photo) photo.tags = tags;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    clearError: () =>
      set((state) => {
        state.error = null;
      }),

    reset: () =>
      set((state) => {
        Object.assign(state, initialState);
      }),
  })),
);
