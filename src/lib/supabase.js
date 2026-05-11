import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// If env vars are missing, supabase will be null and the app falls back to
// local-only mode. This is the public-tier path.
export const supabase = (url && anonKey) ? createClient(url, anonKey) : null
