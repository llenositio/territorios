import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://logscbqojxfyrewfoqas.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ycK_RSR1KXlpwFtMb9Skgg_d01qRpM-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
