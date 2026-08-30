import { describe, expect, it } from "vitest";

import { getProgressPresentation } from "./progress-summary";
import type { ProgressRecord } from "@/lib/types";

function progress(overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    membership_id: "20000000-0000-4000-8000-000000000001",
    profile_id: "10000000-0000-4000-8000-000000000001",
    school_year_id: "30000000-0000-4000-8000-000000000001",
    full_name: "Maya Chen",
    membership_status: "active",
    target_hours: 20,
    approved_hours: 0,
    pending_hours: 0,
    changes_requested_hours: 0,
    rejected_hours: 0,
    remaining_hours: 20,
    over_goal_hours: 0,
    actual_percentage: 0,
    approved_count: 0,
    pending_count: 0,
    changes_requested_count: 0,
    rejected_count: 0,
    draft_count: 0,
    withdrawn_count: 0,
    last_activity_at: null,
    ...overrides,
  };
}

describe("progress presentation", () => {
  it("uses the approved and pending wording in the zero state", () => {
    expect(getProgressPresentation(progress())).toMatchObject({
      summary: "0 of 20 approved · 0 pending · 20 approved hours remaining",
      approvedVisual: 0,
      pendingPercentage: 0,
      pendingVisual: 0,
    });
  });

  it("places the pending share immediately after the approved share", () => {
    expect(
      getProgressPresentation(
        progress({
          approved_hours: 14.5,
          pending_hours: 3.25,
          remaining_hours: 5.5,
          actual_percentage: 72.5,
        }),
      ),
    ).toMatchObject({
      summary: "14.5 of 20 approved · 3.25 pending · 5.5 approved hours remaining",
      approvedVisual: 72.5,
      pendingPercentage: 16.25,
      pendingVisual: 16.25,
    });
  });

  it("caps the visual at 100 percent without hiding over-requirement totals", () => {
    expect(
      getProgressPresentation(
        progress({
          approved_hours: 22.5,
          pending_hours: 4,
          remaining_hours: 0,
          over_goal_hours: 2.5,
          actual_percentage: 112.5,
        }),
      ),
    ).toMatchObject({
      summary: "22.5 of 20 approved · 4 pending · 2.5 approved hours over requirement",
      approvedVisual: 100,
      pendingPercentage: 20,
      pendingVisual: 0,
    });
  });
});
