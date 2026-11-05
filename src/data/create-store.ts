import { createLocalStore } from "./local-store";
import { createSupabaseStore } from "./supabase-store";
import { backend, type Store } from "./store";

export const createStore = (): Store =>
  backend === "supabase" ? createSupabaseStore() : createLocalStore();
