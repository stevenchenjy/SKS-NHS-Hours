"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { bulkApproveTeacherRequestsAction } from "@/app/actions/review-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BulkApprovalInput,
  BulkApprovalOutcome,
  BulkApprovalResult,
} from "@/lib/domain/bulk-approval";
import { parseQuarterHourUnits } from "@/lib/domain/hours";
import type { PendingQueueItem } from "@/lib/types";

type Selection = BulkApprovalInput["requests"][number];
type Attempt = { input: BulkApprovalInput; requests: PendingQueueItem[] };

const outcomeLabels: Record<BulkApprovalOutcome, string> = {
  approved: "Approved",
  already_processed: "Already processed by a reviewer",
  changed_since_selection: "Changed since selection — review again",
  not_eligible: "Not eligible for teacher approval",
};

function snapshot(request: PendingQueueItem): Selection {
  return {
    requestId: request.id,
    expectedRevision: request.revision,
    expectedUpdatedAt: request.updated_at,
  };
}

function matches(request: PendingQueueItem | undefined, selected: Selection | undefined): boolean {
  return Boolean(
    request &&
    selected &&
    request.status === "pending" &&
    request.approval_stage === "teacher" &&
    request.committee_head_approved_at &&
    request.revision === selected.expectedRevision &&
    request.updated_at === selected.expectedUpdatedAt,
  );
}

function totalHours(requests: PendingQueueItem[]): string {
  // Sum integer quarter-hour units so historical fractional entries remain exact.
  return String(
    requests.reduce((units, request) => units + parseQuarterHourUnits(request.hours), 0) / 4,
  );
}

function approvalDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function TeacherApprovalQueue({
  requests,
  schoolYearId,
  selectionScope,
  preview = false,
}: {
  requests: PendingQueueItem[];
  schoolYearId: string;
  selectionScope: string;
  preview?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [confirmation, setConfirmation] = useState<Attempt | null>(null);
  const [retry, setRetry] = useState<Attempt | null>(null);
  const [result, setResult] = useState<{
    value: BulkApprovalResult;
    requests: PendingQueueItem[];
  } | null>(null);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const currentById = new Map(requests.map((request) => [request.id, request]));
  const completed = new Set(
    result?.value.results
      .filter((item) => item.outcome === "approved" || item.outcome === "already_processed")
      .map((item) => item.requestId),
  );
  const eligible = requests
    .filter((request) => matches(request, snapshot(request)) && !completed.has(request.id))
    .slice(0, 50);
  const eligibleIds = new Set(eligible.map((request) => request.id));
  const selection = eligible.filter(
    (request) => selected[request.id] && matches(request, selected[request.id]),
  );
  const staleCount = Object.keys(selected).length - selection.length;
  const locked = pending || Boolean(retry) || preview;
  const changedConfirmation = Boolean(
    confirmation &&
    !retry &&
    confirmation.input.requests.some((item) => !matches(currentById.get(item.requestId), item)),
  );

  function selectPage() {
    if (locked) return;
    setSelected(Object.fromEntries(eligible.map((request) => [request.id, snapshot(request)])));
  }

  function confirmSelection() {
    if (preview || pending) return;
    const attempt = retry ?? {
      input: {
        schoolYearId,
        batchId: crypto.randomUUID(),
        requests: selection.map(snapshot),
      },
      requests: selection,
    };
    if (attempt.input.requests.length === 0) return;
    setConfirmation(attempt);
    setOpen(true);
  }

  function submitApproval() {
    if (!confirmation || preview || submitting.current || changedConfirmation) return;
    const attempt = confirmation;
    submitting.current = true;
    setError(undefined);
    startTransition(async () => {
      try {
        const response = await bulkApproveTeacherRequestsAction(attempt.input);
        if (!response.result) {
          setRetry(attempt);
          setError(
            response.error ??
              "Approval results could not be confirmed. Retry this batch to check its result.",
          );
          return;
        }
        setResult({ value: response.result, requests: attempt.requests });
        setSelected({});
        setRetry(null);
        setConfirmation(null);
        setOpen(false);
      } catch {
        setRetry(attempt);
        setError(
          "Approval results could not be confirmed. Retry this batch to recover its recorded result.",
        );
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <section
      aria-label="Teacher approval requests"
      data-selection-scope={selectionScope}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4">
        <div className="flex flex-col gap-1">
          <p role="status" aria-live="polite" className="font-semibold">
            {selection.length} selected · {totalHours(selection)} hours
          </p>
          <p className="text-sm text-muted-foreground">
            Select up to 50 requests on this page after reviewing their details.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={locked || eligible.length === 0}
            onClick={selectPage}
          >
            Select this page
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={locked || Object.keys(selected).length === 0}
            onClick={() => setSelected({})}
          >
            Clear selection
          </Button>
          <Button
            disabled={preview || pending || (!retry && selection.length === 0)}
            onClick={confirmSelection}
          >
            <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
            {pending ? "Approving…" : retry ? "Retry approval" : "Approve selected"}
          </Button>
        </div>
      </div>

      {staleCount > 0 && !retry ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {staleCount} selected request{staleCount === 1 ? " was" : "s were"} removed from selection
          because the queue changed. Review the current details before selecting again.
        </p>
      ) : null}
      {error && !open ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <section
          aria-label="Approval results"
          className="flex flex-col gap-2 rounded-xl border p-4"
        >
          <p role="status" className="font-semibold">
            {result.value.approvedCount} of {result.value.results.length} requests approved.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {result.value.results.map((item) => {
              const request = result.requests.find((row) => row.id === item.requestId);
              return (
                <li key={item.requestId}>
                  <span className="font-medium">
                    {request?.member_name} — {request?.title}
                  </span>
                  : {outcomeLabels[item.outcome]}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground">
            Approved requests move to Archive for all teachers. Requests that changed need another
            review.
          </p>
        </section>
      ) : null}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <span className="sr-only">Select request</span>
              </TableHead>
              <TableHead>Member and activity</TableHead>
              <TableHead>Service date</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Committee head</TableHead>
              <TableHead>
                <span className="sr-only">Review individually</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length ? (
              requests.map((request) => (
                <Fragment key={request.id}>
                  <TableRow>
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${request.member_name}: ${request.title}`}
                        checked={selection.some((item) => item.id === request.id)}
                        disabled={locked || !eligibleIds.has(request.id)}
                        onCheckedChange={(checked) => {
                          if (locked || !eligibleIds.has(request.id)) return;
                          setSelected(() => {
                            const next = Object.fromEntries(
                              selection.map((item) => [item.id, snapshot(item)]),
                            );
                            if (checked) next[request.id] = snapshot(request);
                            else delete next[request.id];
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="min-w-48 max-w-sm whitespace-normal">
                      <p className="font-semibold">{request.member_name}</p>
                      <p>{request.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {request.category_name} · {request.waiting_days} day
                        {request.waiting_days === 1 ? "" : "s"} waiting
                      </p>
                      {!request.committee_head_approved_at ? (
                        <Badge variant="outline">Needs committee-head reassignment</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{request.service_date}</TableCell>
                    <TableCell>{request.hours}</TableCell>
                    <TableCell>{request.requested_approver_name}</TableCell>
                    <TableCell>
                      {preview ? (
                        <Button variant="outline" size="sm" disabled>
                          Review
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          render={<Link href={`/admin/requests/${request.id}`} />}
                        >
                          Review
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={6} className="whitespace-normal pt-0">
                      <details className="px-1 pb-2 sm:pl-10">
                        <summary className="w-fit cursor-pointer text-sm font-medium">
                          Activity details for {request.member_name}
                        </summary>
                        <div className="mt-3 flex max-w-3xl flex-col gap-2 text-sm">
                          <p className="whitespace-pre-wrap">
                            {request.description || "No additional description provided."}
                          </p>
                          <p className="text-muted-foreground">
                            {request.committee_head_approved_at
                              ? `Committee-head approval: ${request.requested_approver_name} · ${approvalDate(request.committee_head_approved_at)}`
                              : "Committee-head approval is still required. An admin must reassign this request before teacher approval."}
                          </p>
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No pending requests match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {confirmation?.requests.length ?? 0} selected{" "}
              {confirmation?.requests.length === 1 ? "request" : "requests"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This gives final teacher approval for{" "}
              {confirmation ? totalHours(confirmation.requests) : "0"} hours. The hours will count
              toward each member’s progress, and these requests will move to Archive for every
              teacher.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            aria-label="Requests to approve"
            className="flex max-h-64 flex-col gap-3 overflow-y-auto text-sm"
          >
            {confirmation?.requests.map((request) => (
              <li key={request.id} className="flex justify-between gap-4">
                <span>
                  <strong>{request.member_name}</strong>
                  <br />
                  {request.title}
                </span>
                <span className="shrink-0">{request.hours} hours</span>
              </li>
            ))}
          </ul>
          {changedConfirmation ? (
            <p role="alert" className="text-sm text-destructive">
              The queue changed after this confirmation opened. Close it and review the current
              selection before approving.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{retry ? "Close" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || changedConfirmation || preview}
              onClick={submitApproval}
            >
              {pending ? "Approving…" : retry ? "Retry same batch" : "Give final approval"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
