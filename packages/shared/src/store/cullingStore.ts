import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { freeze } from 'immer';
import type { CullingItem, CullingDecision, Photo } from '../types';
export interface CullingState {
  items: CullingItem[];
  allItems: CullingItem[];
  currentIndex: number;
  isProcessing: boolean;
  isComplete: boolean;
  error: string | null;
  history: Array<{ photoId: string; previousDecision: CullingDecision }>;

  // Actions
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
  error: null as string | null,
  history: [] as Array<{ photoId: string; previousDecision: CullingDecision }>,
};

export const useCullingStore = create<CullingState>()(
  immer((set, get) => ({
    ...initialState,

    decide: (photoId, decision) => {
      // Search the immutable state: reading every item through an Immer draft
      // creates thousands of proxies on every tap in a large review batch.
      const state = get();
      const itemIndex = state.items.findIndex((i) => i.photo.id === photoId);
      if (itemIndex === -1) return;

      const item = state.items[itemIndex]!;
      const items = state.items.slice();
      items[itemIndex] = { ...item, decision };
      const allItems = state.allItems === state.items ? items : state.allItems.slice();
      const allIdx = state.allItems.findIndex((i) => i.photo.id === photoId);
      if (allIdx !== -1) {
        allItems[allIdx] = { ...state.allItems[allIdx]!, decision };
      }

      let nextIndex = -1;
      for (let offset = 1; offset < items.length; offset++) {
        const index = (itemIndex + offset) % items.length;
        if (items[index]!.decision === 'pending') {
          nextIndex = index;
          break;
        }
      }
      set({
        items: freeze(items, true),
        allItems: freeze(allItems, true),
        history: freeze([...state.history, { photoId, previousDecision: item.decision }], true),
        currentIndex: nextIndex === -1 ? state.currentIndex : nextIndex,
        isComplete: nextIndex === -1,
      });
    },

    undoLast: () => {
      const state = get();
      if (state.history.length === 0) return;

      const last = state.history[state.history.length - 1]!;
      const idx = state.items.findIndex((i) => i.photo.id === last.photoId);
      const items = state.items.slice();
      if (idx !== -1) {
        items[idx] = { ...items[idx]!, decision: last.previousDecision };
      }
      const allItems = state.allItems === state.items ? items : state.allItems.slice();
      const allIdx = state.allItems.findIndex((i) => i.photo.id === last.photoId);
      if (allIdx !== -1) {
        allItems[allIdx] = { ...allItems[allIdx]!, decision: last.previousDecision };
      }
      set({
        items: freeze(items, true),
        allItems: freeze(allItems, true),
        history: freeze(state.history.slice(0, -1), true),
        currentIndex: idx === -1 ? state.currentIndex : idx,
        isComplete: false,
      });
    },

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
