import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let configured = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (configured) return client;
  configured = true;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    client = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return client;
}

export function requireSupabaseClient(): SupabaseClient {
  const current = getSupabaseClient();
  if (current === null) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  return current;
}
