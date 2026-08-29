"use client";

import { useActionState } from "react";
import { History } from "lucide-react";

import { correctApprovedRequestAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { HourRequest, ServiceCategory } from "@/lib/types";

const initialState: AdminFormState = {};

export function CorrectionForm({
  request,
  categories,
}: {
  request: HourRequest;
  categories: ServiceCategory[];
}) {
  const [state, action, pending] = useActionState(correctApprovedRequestAction, initialState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="request_id" value={request.id} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="correction-title">Activity title</FieldLabel>
          <Input id="correction-title" name="title" defaultValue={request.title} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="correction-description">Description</FieldLabel>
          <Textarea
            id="correction-description"
            name="description"
            defaultValue={request.description}
            rows={5}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="correction-category">Category</FieldLabel>
            <select
              id="correction-category"
              name="category_id"
              defaultValue={request.category_id}
              className="h-9 rounded-lg border bg-background px-2 text-sm"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="correction-date">Service date</FieldLabel>
            <Input
              id="correction-date"
              name="service_date"
              type="date"
              defaultValue={request.service_date}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="correction-hours">Hours</FieldLabel>
            <Input
              id="correction-hours"
              name="hours"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              defaultValue={request.hours}
              required
            />
          </Field>
        </div>
        <Field data-invalid={Boolean(state.fieldErrors?.reason)}>
          <FieldLabel htmlFor="correction-reason">Correction reason</FieldLabel>
          <Textarea
            id="correction-reason"
            name="reason"
            rows={4}
            minLength={8}
            maxLength={2000}
            required
            placeholder="State why this approved school record must change."
          />
          <FieldDescription>
            The original values, new values, actor, reason, and timestamp are preserved.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.reason?.[0]}</FieldError>
        </Field>
      </FieldGroup>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        <History data-icon="inline-start" aria-hidden="true" />
        {pending ? "Recording correction…" : "Record traceable correction"}
      </Button>
    </form>
  );
}
