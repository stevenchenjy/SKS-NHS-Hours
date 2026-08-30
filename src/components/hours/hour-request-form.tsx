"use client";

import { useActionState } from "react";
import { CheckCircle2, Save } from "lucide-react";

import { saveHourRequestAction, type HourRequestFormState } from "@/app/actions/hour-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRoleLabel } from "@/lib/domain/roles";
import type { HourRequest, ReviewerOption, ServiceCategory } from "@/lib/types";

const initialState: HourRequestFormState = {};

export function HourRequestForm({
  schoolYearId,
  schoolYearLabel,
  categories,
  reviewers,
  submissionKey,
  request,
}: {
  schoolYearId: string;
  schoolYearLabel: string;
  categories: ServiceCategory[];
  reviewers: ReviewerOption[];
  submissionKey: string;
  request?: HourRequest;
}) {
  const [state, action, pending] = useActionState(saveHourRequestAction, initialState);
  const currentCategory = request?.category_id ?? undefined;
  const currentReviewer = request?.requested_approver_membership_id ?? undefined;
  const today = new Date().toISOString().slice(0, 10);
  const categoryItems = Object.fromEntries(
    categories.map((category) => [category.id, category.name]),
  );
  const reviewerItems = Object.fromEntries(
    reviewers.map((reviewer) => [
      reviewer.membershipId,
      `${reviewer.fullName} · ${reviewer.roles.map(formatRoleLabel).join(", ")}`,
    ]),
  );

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="school_year_id" value={schoolYearId} />
      <input type="hidden" name="client_submission_key" value={submissionKey} />
      <input type="hidden" name="revision" value={request?.revision ?? 0} />
      {request ? <input type="hidden" name="request_id" value={request.id} /> : null}

      <section aria-labelledby="activity-fields" className="space-y-5">
        <div>
          <h2 id="activity-fields" className="text-xl font-bold">
            Activity details
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Record one service activity for {schoolYearLabel}. Approved hours count toward progress.
          </p>
        </div>
        <FieldGroup>
          <Field data-invalid={Boolean(state.fieldErrors?.title)}>
            <FieldLabel htmlFor="title">Activity title</FieldLabel>
            <Input
              id="title"
              name="title"
              required
              maxLength={120}
              defaultValue={request?.title ?? ""}
              placeholder="Example: Saturday food pantry shift"
              className="h-11"
            />
            <FieldError>{state.fieldErrors?.title?.[0]}</FieldError>
          </Field>
          <Field data-invalid={Boolean(state.fieldErrors?.description)}>
            <FieldLabel htmlFor="description">What service did you perform?</FieldLabel>
            <Textarea
              id="description"
              name="description"
              required
              minLength={20}
              maxLength={2000}
              rows={6}
              defaultValue={request?.description ?? ""}
              placeholder="Describe what you did, whom it served, and your responsibilities."
              className="min-h-36 resize-y text-base"
            />
            <FieldDescription>
              Be specific enough for a school leader to make a decision.
            </FieldDescription>
            <FieldError>{state.fieldErrors?.description?.[0]}</FieldError>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(state.fieldErrors?.category_id)}>
              <FieldLabel htmlFor="category_id">Service category</FieldLabel>
              <Select
                name="category_id"
                defaultValue={currentCategory}
                items={categoryItems}
                required
              >
                <SelectTrigger id="category_id" className="h-11 w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError>{state.fieldErrors?.category_id?.[0]}</FieldError>
            </Field>
            <Field data-invalid={Boolean(state.fieldErrors?.service_date)}>
              <FieldLabel htmlFor="service_date">Service date</FieldLabel>
              <Input
                id="service_date"
                name="service_date"
                type="date"
                max={today}
                required
                defaultValue={request?.service_date ?? ""}
                className="h-11"
              />
              <FieldError>{state.fieldErrors?.service_date?.[0]}</FieldError>
            </Field>
          </div>
          <Field data-invalid={Boolean(state.fieldErrors?.hours)}>
            <FieldLabel htmlFor="hours">Hours</FieldLabel>
            <Input
              id="hours"
              name="hours"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              inputMode="decimal"
              required
              defaultValue={request?.hours ?? ""}
              className="h-11 max-w-44"
            />
            <FieldDescription>Use quarter-hour increments, from 0.25 through 24.</FieldDescription>
            <FieldError>{state.fieldErrors?.hours?.[0]}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section aria-labelledby="reviewer-fields" className="space-y-5 border-t pt-8">
        <div>
          <h2 id="reviewer-fields" className="text-xl font-bold">
            Requested approver
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The request appears in this leader’s assigned queue and every active leader’s pending
            queue.
          </p>
        </div>
        <Field data-invalid={Boolean(state.fieldErrors?.requested_approver_membership_id)}>
          <FieldLabel htmlFor="requested_approver_membership_id">School leader</FieldLabel>
          <Select
            name="requested_approver_membership_id"
            defaultValue={currentReviewer}
            items={reviewerItems}
            required
          >
            <SelectTrigger
              id="requested_approver_membership_id"
              className="h-11 w-full sm:max-w-xl"
            >
              <SelectValue placeholder="Choose a reviewer" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {reviewers.map((reviewer) => (
                  <SelectItem key={reviewer.membershipId} value={reviewer.membershipId}>
                    {reviewer.fullName} · {reviewer.roles.map(formatRoleLabel).join(", ")}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError>{state.fieldErrors?.requested_approver_membership_id?.[0]}</FieldError>
        </Field>
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <aside className="rounded-xl border bg-muted/45 p-5 text-sm leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground">What happens next</p>
        <p className="mt-1">
          {request?.status === "changes_requested"
            ? "Saving keeps the request in changes requested so you can return later. Resubmitting locks the updated version while a leader reviews it."
            : "Saving keeps the request editable as a draft. Submitting locks this version while a leader reviews it. Pending hours are shown separately and do not count toward the requirement."}
        </p>
      </aside>

      <div className="sticky bottom-[4.2rem] z-20 -mx-5 flex flex-col-reverse gap-3 border-t bg-background/97 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:px-0 lg:bottom-0">
        <Button
          type="submit"
          name="intent"
          value={request?.status === "changes_requested" ? "save_changes" : "save_draft"}
          variant="outline"
          size="lg"
          className="h-11"
          disabled={pending}
        >
          <Save data-icon="inline-start" aria-hidden="true" />
          {request?.status === "changes_requested" ? "Save changes" : "Save draft"}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="submit"
          size="lg"
          className="h-11"
          disabled={pending}
        >
          <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
          {pending
            ? "Saving…"
            : request?.status === "changes_requested"
              ? "Resubmit request"
              : "Submit request"}
        </Button>
      </div>
    </form>
  );
}
