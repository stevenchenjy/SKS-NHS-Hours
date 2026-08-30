import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/lib/env";

export function createSupabaseAdminClient() {
  const environment = getServerEnvironment();
  if (!environment.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is required for this operation.");
  }

  return createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
