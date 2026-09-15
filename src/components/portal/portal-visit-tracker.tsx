"use client";

import { useEffect } from "react";

import { recordPortalVisitAction } from "@/app/actions/account-activity-actions";

export function PortalVisitTracker() {
  useEffect(() => {
    // This runs only on entry to the rendered portal, not during server rendering
    // or link prefetching. Repeated visits preserve the first timestamp in SQL.
    void recordPortalVisitAction().catch(() => {
      // Tracking must not interrupt portal use. A later visit can retry.
    });
  }, []);
  return null;
}
