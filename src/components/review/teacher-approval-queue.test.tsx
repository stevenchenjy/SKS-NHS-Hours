// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingQueueItem } from "@/lib/types";

const approve = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/review-actions", () => ({ bulkApproveTeacherRequestsAction: approve }));

import { TeacherApprovalQueue } from "./teacher-approval-queue";

const schoolYearId = "10000000-0000-4000-8000-000000000001";
function request(index: number, overrides: Partial<PendingQueueItem> = {}): PendingQueueItem {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    school_year_id: schoolYearId,
    member_membership_id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    category_id: "30000000-0000-4000-8000-000000000001",
    requested_approver_membership_id: "20000000-0000-4000-8000-000000000010",
    committee_head_reviewer_membership_id: "20000000-0000-4000-8000-000000000010",
    committee_head_approved_at: "2026-10-14T12:00:00.000001Z",
    actual_reviewer_membership_id: null,
    title: `Activity ${index}`,
    description: `Description for activity ${index}`,
    hours: index === 1 ? "1.25" : "3.5",
    service_date: "2026-10-12",
    status: "pending",
    revision: 2,
    created_at: "2026-10-12T12:00:00Z",
    submitted_at: "2026-10-13T12:00:00Z",
    updated_at: "2026-10-14T12:00:00.000001Z",
    decided_at: null,
    member_profile_id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    member_name: `Member ${index}`,
    category_name: "Community Service",
    requested_approver_name: "Casey Committee",
    approval_stage: "teacher",
    assigned_to_current_user: true,
    waiting_since: "2026-10-14T12:00:00Z",
    waiting_days: 1,
    ...overrides,
  };
}
const first = request(1);
const second = request(2);
function queue(requests: PendingQueueItem[], scope = "page-1", preview = false) {
  return (
    <TeacherApprovalQueue
      key={scope}
      requests={requests}
      schoolYearId={schoolYearId}
      selectionScope={scope}
      preview={preview}
    />
  );
}
function selectPage() {
  fireEvent.click(screen.getByRole("button", { name: "Select this page" }));
}
function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "Approve selected" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  approve.mockReset();
});

describe("teacher bulk approval queue", () => {
  it("selects only eligible rows, totals historical fractions exactly, and confirms the named requests", () => {
    render(
      queue([
        first,
        second,
        request(3, { committee_head_approved_at: null, approval_stage: "committee_head" }),
      ]),
    );
    expect(screen.getByRole("button", { name: "Approve selected" })).toBeDisabled();
    selectPage();
    expect(screen.getByText("2 selected · 4.75 hours")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Select Member 3: Activity 3" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByText("Activity details for Member 1"));
    expect(screen.getByText("Description for activity 1")).toBeVisible();
    expect(
      screen.getAllByText("Committee-head approval: Casey Committee · Oct 14, 2026"),
    ).toHaveLength(2);
    openConfirmation();
    const dialog = screen.getByRole("alertdialog", { name: "Approve 2 selected requests?" });
    expect(dialog).toHaveTextContent("4.75 hours");
    expect(within(dialog).getByLabelText("Requests to approve")).toHaveTextContent(
      "Member 1Activity 11.25 hours",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps unchanged selections across refresh, removes changed rows, and never selects new arrivals", () => {
    const { rerender } = render(queue([first, second]));
    selectPage();
    rerender(
      queue([first, { ...second, revision: 3, updated_at: "2026-10-15T12:00:00Z" }, request(3)]),
    );
    expect(screen.getByText("1 selected · 1.25 hours")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Select Member 1: Activity 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Member 2: Activity 2" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Member 3: Activity 3" })).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "removed from selection because the queue changed",
    );
    openConfirmation();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Approve 1 selected request?");
  });

  it("requires another review if a request changes while confirmation is open", () => {
    const { rerender } = render(queue([first]));
    selectPage();
    openConfirmation();
    rerender(queue([{ ...first, updated_at: "2026-10-15T12:00:00Z" }]));
    expect(screen.getByRole("button", { name: "Give final approval" })).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "The queue changed after this confirmation opened",
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it("sends exact snapshots once, locks pending controls, and reports mixed outcomes on the queue", async () => {
    let finish!: (value: unknown) => void;
    approve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(queue([first, second]));
    selectPage();
    openConfirmation();
    const confirm = screen.getByRole("button", { name: "Give final approval" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Clear selection")).toBeDisabled();
    expect(document.querySelector('[aria-label="Select Member 1: Activity 1"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const input = approve.mock.calls[0]![0];
    expect(input).toMatchObject({
      schoolYearId,
      requests: [
        { requestId: first.id, expectedRevision: 2, expectedUpdatedAt: first.updated_at },
        { requestId: second.id, expectedRevision: 2, expectedUpdatedAt: second.updated_at },
      ],
    });
    await act(async () =>
      finish({
        result: {
          batchId: input.batchId,
          approvedCount: 1,
          results: [
            { requestId: first.id, outcome: "approved" },
            { requestId: second.id, outcome: "already_processed" },
          ],
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Approval results" })).toHaveTextContent(
      "1 of 2 requests approved.",
    );
    expect(screen.getByRole("region", { name: "Approval results" })).toHaveTextContent(
      "Already processed by a reviewer",
    );
    expect(screen.getByText("0 selected · 0 hours")).toBeVisible();
    rerender(queue([]));
    expect(screen.getByRole("region", { name: "Approval results" })).toHaveTextContent(
      "1 of 2 requests approved.",
    );
  });

  it("retries the identical batch and payload after uncertain network delivery, even if rows refresh", async () => {
    approve.mockRejectedValueOnce(new Error("network disconnected"));
    const { rerender } = render(queue([first]));
    selectPage();
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Give final approval" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry same batch" })).toBeEnabled(),
    );
    const input = approve.mock.calls[0]![0];
    rerender(queue([]));
    approve.mockResolvedValueOnce({
      result: {
        batchId: input.batchId,
        approvedCount: 1,
        results: [{ requestId: first.id, outcome: "approved" }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry same batch" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
    expect(approve.mock.calls[1]![0]).toEqual(input);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Approval results" })).toHaveTextContent(
        "1 of 1 requests approved.",
      ),
    );
  });

  it("resets selection on filter/page navigation, and supports explicitly clearing it", () => {
    const { rerender } = render(queue([first]));
    selectPage();
    rerender(queue([first], "page-2"));
    expect(screen.getByText("0 selected · 0 hours")).toBeVisible();
    selectPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("limits select-page to 50 requests and keeps preview actions disabled", () => {
    const { rerender } = render(
      queue(Array.from({ length: 51 }, (_, index) => request(index + 1))),
    );
    selectPage();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(50);
    expect(screen.getByRole("checkbox", { name: "Select Member 51: Activity 51" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    rerender(queue([first], "preview", true));
    expect(screen.getByRole("button", { name: "Select this page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve selected" })).toBeDisabled();
    expect(approve).not.toHaveBeenCalled();
  });
});
