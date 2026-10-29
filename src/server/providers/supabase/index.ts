/**
 * Supabase implementation of the swappable data-access layer.
 *
 * This file is a placeholder. When we wire up Supabase we will fill it with
 * the real Supabase client calls and delete the Convex provider referenced by
 * the DATA_PROVIDER selector. While it stays as a shell we keep the Convex
 * provider as the default so the rest of the server keeps working.
 *
 * Selection is by DATA_PROVIDER:
 *   DATA_PROVIDER=convex   → src/server/providers/convex
 *   DATA_PROVIDER=supabase → this file
 */

throw new Error(
  "Supabase provider is not wired yet. Set DATA_PROVIDER=convex to keep using Convex.",
);
