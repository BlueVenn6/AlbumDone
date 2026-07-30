import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CullingItem, CullingDecision, Photo } from '../types';
import type { LLMClient } from '../api/llmClient';
import { preProcessForCulling } from '../api/vision';
import { getResolvedLocale, i18next } from '../i18n';

export interface AiStats {
  autoKept: number;
  autoDeleted: number;
  uncertainCount: number;
}

export interface CullingState {
  items: CullingItem[]; // Only uncertain items (requiring human review)
  allItems: CullingItem[]; // All items including AI-decided ones
  currentIndex: number;
  isProcessing: boolean;
  isComplete: boolean;
  aiStats: AiStats;
  error: string | null;
  history: Array<{ photoId: string; previousDecision: CullingDecision }>;

  // Actions
  runAIPreprocess: (photos: Photo[], client: LLMClient) => Promise<void>;
  decide: (photoId: string, decision: 'keep' | 'delete') => void;
  undoLast: () => void;
  goToNext: () => void;
  goToPrev: () => void;
  reset: () => void;
  setError: (error: string | null) => void;

  // Computed selectors (accessed as getters)
  getCurrentItem: () => CullingItem | null;
  getKeptPhotos: () => Photo[];
  getDeletedPhotos: () => Photo[];
  getPendingPhotos: () => Photo[];
}

const initialState = {
  items: [] as CullingItem[],
  allItems: [] as CullingItem[],
  currentIndex: 0,
  isProcessing: false,
  isComplete: false,
  aiStats: { autoKept: 0, autoDeleted: 0, uncertainCount: 0 } as AiStats,
  error: null as string | null,
  history: [] as Array<{ photoId: string; previousDecision: CullingDecision }>,
};

export const useCullingStore = create<CullingState>()(
  immer((set, get) => ({
    ...initialState,

    runAIPreprocess: async (photos, client) => {
      if (photos.length === 0) return;

      set((state) => {
        state.isProcessing = true;
        state.error = null;
        state.items = [];
        state.allItems = [];
        state.currentIndex = 0;
        state.isComplete = false;
        state.history = [];
      });

      try {
        const result = await preProcessForCulling(photos, client, getResolvedLocale());

        const keepSet = new Set(result.keep);
        const deleteSet = new Set(result.delete);

        const allItems: CullingItem[] = photos.map((photo) => {
          let aiDecision: CullingDecision = 'pending';
          if (keepSet.has(photo.id)) aiDecision = 'keep';
          else if (deleteSet.has(photo.id)) aiDecision = 'delete';

          return {
            photo,
            decision: aiDecision === 'pending' ? 'pending' : aiDecision,
            aiDecision,
          };
        });

        // Only uncertain items need human review
        const uncertainItems = allItems.filter(
          (item) => item.aiDecision === 'pending',
        );

        set((state) => {
          state.allItems = allItems;
          state.items = uncertainItems;
          state.aiStats = {
            autoKept: result.keep.length,
            autoDeleted: result.delete.length,
            uncertainCount: result.uncertain.length,
          };
          state.currentIndex = 0;
          state.isProcessing = false;
          state.isComplete = uncertainItems.length === 0;
        });
      } catch (err) {
        // If AI preprocessing fails, treat all photos as uncertain
        const uncertainItems: CullingItem[] = photos.map((photo) => ({
          photo,
          decision: 'pending' as CullingDecision,
          aiDecision: 'pending' as CullingDecision,
        }));

        set((state) => {
          state.allItems = uncertainItems;
          state.items = uncertainItems;
          state.aiStats = {
            autoKept: 0,
            autoDeleted: 0,
            uncertainCount: photos.length,
          };
          state.currentIndex = 0;
          state.isProcessing = false;
          state.error =
            err instanceof Error ? err.message : i18next.t('analysis.cullingFallbackManual');
          state.isComplete = photos.length === 0;
        });
      }
    },

    decide: (photoId, decision) =>
      set((state) => {
        const itemIndex = state.items.findIndex((i) => i.photo.id === photoId);
        if (itemIndex === -1) return;

        const item = state.items[itemIndex]!;
        // Save to history for undo
        state.history.push({ photoId, previousDecision: item.decision });

        // Update decision
        item.decision = decision;

        // Also update in allItems
        const allIdx = state.allItems.findIndex((i) => i.photo.id === photoId);
        if (allIdx !== -1) {
          state.allItems[allIdx]!.decision = decision;
        }

        // Move to next item
        const pendingCount = state.items.filter((i) => i.decision === 'pending').length;
        if (pendingCount === 0) {
          state.isComplete = true;
        } else {
          // Advance to next pending item
          let next = (itemIndex + 1) % state.items.length;
          let iterations = 0;
          while (state.items[next]!.decision !== 'pending' && iterations < state.items.length) {
            next = (next + 1) % state.items.length;
            iterations++;
          }
          state.currentIndex = next;
        }
      }),

    undoLast: () =>
      set((state) => {
        if (state.history.length === 0) return;

        const last = state.history.pop()!;
        const item = state.items.find((i) => i.photo.id === last.photoId);
        if (item) {
          item.decision = last.previousDecision;
        }

        const allItem = state.allItems.find((i) => i.photo.id === last.photoId);
        if (allItem) {
          allItem.decision = last.previousDecision;
        }

        // Find the item's index and go back to it
        const idx = state.items.findIndex((i) => i.photo.id === last.photoId);
        if (idx !== -1) {
          state.currentIndex = idx;
        }
        state.isComplete = false;
      }),

    goToNext: () =>
      set((state) => {
        if (state.currentIndex < state.items.length - 1) {
          state.currentIndex++;
        }
      }),

    goToPrev: () =>
      set((state) => {
        if (state.currentIndex > 0) {
          state.currentIndex--;
        }
      }),

    getCurrentItem: () => {
      const { items, currentIndex } = get();
      return items[currentIndex] ?? null;
    },

    getKeptPhotos: () => {
      const { allItems } = get();
      return allItems
        .filter((i) => i.decision === 'keep')
        .map((i) => i.photo);
    },

    getDeletedPhotos: () => {
      const { allItems } = get();
      return allItems
        .filter((i) => i.decision === 'delete')
        .map((i) => i.photo);
    },

    getPendingPhotos: () => {
      const { items } = get();
      return items.filter((i) => i.decision === 'pending').map((i) => i.photo);
    },

    reset: () =>
      set((state) => {
        Object.assign(state, initialState);
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),
  })),
);
