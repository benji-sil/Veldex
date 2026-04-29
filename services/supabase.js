import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://heoehyhdjawsoffgkdym.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_L1o2o2uB9PK_CTkkdk812w_UI5JspYz";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);