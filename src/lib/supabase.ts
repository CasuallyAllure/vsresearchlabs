import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient | null = null;

const hasValidUrl =
  typeof supabaseUrl === 'string' &&
  (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://'));
const hasKey = typeof supabaseAnonKey === 'string' && supabaseAnonKey.length > 0;

if (hasValidUrl && hasKey) {
  try {
    supabase = createClient(supabaseUrl as string, supabaseAnonKey as string);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Supabase client init failed — running without backend:', err);
    supabase = null;
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('Supabase env missing or placeholder — client not initialized');
}

export { supabase };
