import { create } from "zustand";

// "Importa da Suno": one dialog for the whole app (Library, Create, the sidebar).
export const useImportDialog = create<{
  open: boolean;
  show: () => void;
  hide: () => void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
