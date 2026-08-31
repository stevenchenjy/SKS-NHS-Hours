"use client";

import { useActionState } from "react";
import { CheckCircle2, RotateCcw, Send, XCircle } from "lucide-react";

import {
  reassignHourRequestAction,
  reviewHourRequestAction,
  type ReviewFormState,
} from "@/app/actions/review-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { HourApprovalStage, ReviewerOption } from "@/lib/types";

const initialState: ReviewFormState = {};

export function ReviewDecisionPanel({
  requestId,
  reviewers,
  currentReviewerMembershipId,
  approvalStage,
  canDecide,
  canReassign,
}: {
  requestId: string;
  reviewers: ReviewerOption[];
  currentReviewerMembershipId: string | null;
  approvalStage: HourApprovalStage;
  canDecide: boolean;
  canReassign: boolean;
}) {
  const [reviewState, reviewAction, reviewing] = useActionState(
    reviewHourRequestAction,
    initialState,
  );
  const [reassignState, reassignAction, reassigning] = useActionState(
    reassignHourRequestAction,
    initialState,
  );
  const reviewerItems = Object.fromEntries(
    reviewers.map((reviewer) => [reviewer.membershipId, reviewer.fullName]),
  );

  return (
    <Tabs defaultValue={canDecide ? "decision" : "reassign"} className="w-full">
      {canDecide && canReassign ? (
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="decision">Decision</TabsTrigger>
          <TabsTrigger value="reassign">Reassign</TabsTrigger>
        </TabsList>
      ) : null}
      {canDecide ? (
        <TabsContent value="decision" className="pt-5">
          <form action={reviewAction} className="space-y-5">
            <input type="hidden" name="request_id" value={requestId} />
            <Field data-invalid={Boolean(reviewState.fieldErrors?.comment)}>
              <FieldLabel htmlFor="comment">Reviewer comment</FieldLabel>
              <Textarea
                id="comment"
                name="comment"
                rows={6}
                maxLength={2000}
                placeholder="Explain what the member should know about this decision."
                className="min-h-32 resize-y"
              />
              <FieldDescription>
                Required when requesting changes or rejecting; optional for approval.
              </FieldDescription>
              <FieldError>{reviewState.fieldErrors?.comment?.[0]}</FieldError>
            </Field>
            {reviewState.error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {reviewState.error}
              </p>
            ) : null}
            <div className="grid gap-3">
              <Button type="submit" name="decision" value="approve" size="lg" disabled={reviewing}>
                <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
                {approvalStage === "committee_head"
                  ? "Approve and send to teachers"
                  : "Give final approval"}
              </Button>
              <Button
                type="submit"
                name="decision"
                value="request_changes"
                variant="outline"
                size="lg"
                disabled={reviewing}
              >
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                Request changes
              </Button>
              <Button
                type="submit"
                name="decision"
                value="reject"
                variant="destructive"
                size="lg"
                disabled={reviewing}
              >
                <XCircle data-icon="inline-start" aria-hidden="true" />
                Reject request
              </Button>
            </div>
          </form>
        </TabsContent>
      ) : null}
      {canReassign ? (
        <TabsContent value="reassign" className="pt-5">
          <form action={reassignAction} className="space-y-5">
            <input type="hidden" name="request_id" value={requestId} />
            <Field data-invalid={Boolean(reassignState.fieldErrors?.new_reviewer_membership_id)}>
              <FieldLabel htmlFor="new_reviewer_membership_id">New committee head</FieldLabel>
              <Select
                name="new_reviewer_membership_id"
                defaultValue={currentReviewerMembershipId ?? undefined}
                items={reviewerItems}
                required
              >
                <SelectTrigger id="new_reviewer_membership_id" className="h-11 w-full">
                  <SelectValue placeholder="Choose a committee head" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {reviewers.map((reviewer) => (
                      <SelectItem key={reviewer.membershipId} value={reviewer.membershipId}>
                        {reviewer.fullName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError>{reassignState.fieldErrors?.new_reviewer_membership_id?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="reassignment_comment">Reassignment note</FieldLabel>
              <Textarea
                id="reassignment_comment"
                name="reassignment_comment"
                rows={4}
                maxLength={2000}
              />
            </Field>
            {reassignState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {reassignState.error}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={reassigning}
            >
              <Send data-icon="inline-start" aria-hidden="true" />
              {reassigning ? "Reassigning…" : "Reassign request"}
            </Button>
          </form>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
