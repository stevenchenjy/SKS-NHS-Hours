import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface NavigationIndicators {
  events: boolean;
  notifications: boolean;
}

export async function getNavigationIndicators(): Promise<NavigationIndicators> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_portal_navigation_indicators");
  if (error) throw new Error(`Unable to load navigation indicators: ${error.message}`);
  const indicators = data as Partial<NavigationIndicators> | null;
  return {
    events: indicators?.events === true,
    notifications: indicators?.notifications === true,
  };
}
