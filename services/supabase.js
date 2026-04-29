import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

if (
  !window.VELDEX_ENV ||
  !window.VELDEX_ENV.SUPABASE_URL ||
  !window.VELDEX_ENV.SUPABASE_ANON_KEY
) {
  throw new Error("Missing Supabase configuration. Check env files.");
}

export const supabase = createClient(
  window.VELDEX_ENV.SUPABASE_URL,
  window.VELDEX_ENV.SUPABASE_ANON_KEY
);
