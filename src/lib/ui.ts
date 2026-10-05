import { create } from 'zustand';
import type { LeagueKind } from './types';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UiStore {
  openTitle: { kind: LeagueKind; id: string } | null;
  showTitle: (kind: LeagueKind, id: string) => void;
  closeTitle: () => void;
  toasts: Toast[];
  toast: (message: string, action?: Toast['action']) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useUi = create<UiStore>()((set, get) => ({
  openTitle: null,
  showTitle: (kind, id) => set({ openTitle: { kind, id } }),
  closeTitle: () => set({ openTitle: null }),
  toasts: [],
  toast: (message, action) => {
    const id = nextToastId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, action }] });
    setTimeout(() => get().dismiss(id), action ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
