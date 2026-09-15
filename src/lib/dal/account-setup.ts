import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AccountSetupStatus {
  email: string;
  password_set: boolean;
  first_portal_visit_at: string | null;
}

export async function listAccountSetupStatus(schoolYearId: string): Promise<AccountSetupStatus[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_account_setup_status", {
    p_school_year_id: schoolYearId,
  });
  if (error) throw new Error(`Unable to load account setup status: ${error.message}`);
  return (data ?? []) as AccountSetupStatus[];
}
