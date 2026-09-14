"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LoaderCircle, Send } from "lucide-react";

import {
  createServiceEventAction,
  updateServiceEventAction,
  type ServiceEventFormState,
} from "@/app/actions/event-actions";
import type { ServiceEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

const initialState: ServiceEventFormState = {};

function errorFor(state: ServiceEventFormState, name: string): string | undefined {
  return state.fieldErrors?.[name]?.[0];
}

function FormField({
  name,
  label,
  state,
  description,
  children,
}: {
  name: string;
  label: string;
  state: ServiceEventFormState;
  description?: string;
  children: React.ReactNode;
}) {
  const error = errorFor(state, name);
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function ServiceEventForm({
  schoolYearId,
  contactName,
  contactEmail,
  event,
}: {
  schoolYearId: string;
  contactName: string;
  contactEmail: string;
  event?: ServiceEvent;
}) {
  const [state, formAction, pending] = useActionState(
    event ? updateServiceEventAction : createServiceEventAction,
    initialState,
  );
  const fieldValue = (name: string, fallback = "") => state.values?.[name] ?? fallback;

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="school_year_id" value={schoolYearId} />
      {event ? (
        <>
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="updated_at" value={event.updated_at} />
          <p className="text-sm text-muted-foreground">
            Confirmed and waitlisted volunteers will automatically receive a notification when you
            change event details.
          </p>
        </>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <FieldSet>
        <FieldLegend>Opportunity</FieldLegend>
        <FieldGroup>
          <FormField name="title" label="Event title" state={state}>
            <Input
              id="title"
              name="title"
              maxLength={160}
              placeholder="Fall festival setup"
              defaultValue={fieldValue("title", event?.title)}
              aria-invalid={Boolean(errorFor(state, "title"))}
              required
            />
          </FormField>
          <FormField
            name="description"
            label="What help is needed?"
            state={state}
            description="Include the tasks, expectations, and anything volunteers should bring."
          >
            <Textarea
              id="description"
              name="description"
              rows={5}
              maxLength={5_000}
              placeholder="Help arrange tables, welcome families, and clean up after the event."
              defaultValue={fieldValue("description", event?.description)}
              aria-invalid={Boolean(errorFor(state, "description"))}
              required
            />
          </FormField>
          <FormField name="volunteer_audience" label="Who should volunteer?" state={state}>
            <Input
              id="volunteer_audience"
              name="volunteer_audience"
              maxLength={500}
              defaultValue={fieldValue(
                "volunteer_audience",
                event?.volunteer_audience ?? "All active NHS members",
              )}
              aria-invalid={Boolean(errorFor(state, "volunteer_audience"))}
              required
            />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Where and when</FieldLegend>
        <FieldGroup>
          <FormField name="location" label="Location" state={state}>
            <Input
              id="location"
              name="location"
              maxLength={300}
              placeholder="Main gym, 123 School Lane"
              defaultValue={fieldValue("location", event?.location)}
              aria-invalid={Boolean(errorFor(state, "location"))}
              required
            />
          </FormField>
          <p className="text-sm text-muted-foreground">
            All dates and times are in Eastern Time (New York).
          </p>
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <FormField name="starts_at" label="Starts" state={state}>
              <Input
                id="starts_at"
                name="starts_at"
                type="datetime-local"
                defaultValue={fieldValue("starts_at", event?.starts_at.slice(0, 16))}
                aria-invalid={Boolean(errorFor(state, "starts_at"))}
                required
              />
            </FormField>
            <FormField name="ends_at" label="Ends" state={state}>
              <Input
                id="ends_at"
                name="ends_at"
                type="datetime-local"
                defaultValue={fieldValue("ends_at", event?.ends_at.slice(0, 16))}
                aria-invalid={Boolean(errorFor(state, "ends_at"))}
                required
              />
            </FormField>
          </FieldGroup>
          <FormField
            name="signup_deadline"
            label="Signup deadline"
            state={state}
            description="New signups and waitlist entries close at this time, at or before the event starts. Existing volunteers can still drop out, and waiting volunteers can still be promoted."
          >
            <Input
              id="signup_deadline"
              name="signup_deadline"
              type="datetime-local"
              defaultValue={fieldValue("signup_deadline", event?.signup_deadline.slice(0, 16))}
              aria-invalid={Boolean(errorFor(state, "signup_deadline"))}
              required
            />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Contact and capacity</FieldLegend>
        <FieldGroup>
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <FormField name="contact_name" label="Contact person" state={state}>
              <Input
                id="contact_name"
                name="contact_name"
                maxLength={200}
                defaultValue={fieldValue("contact_name", event?.contact_name ?? contactName)}
                aria-invalid={Boolean(errorFor(state, "contact_name"))}
                required
              />
            </FormField>
            <FormField name="contact_email" label="Contact email" state={state}>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                maxLength={320}
                defaultValue={fieldValue("contact_email", event?.contact_email ?? contactEmail)}
                aria-invalid={Boolean(errorFor(state, "contact_email"))}
                required
              />
            </FormField>
          </FieldGroup>
          <FormField
            name="capacity"
            label="People needed"
            state={state}
            description={
              event
                ? `There are ${event.confirmed_count} confirmed volunteers. Increasing capacity promotes waiting volunteers in order; capacity cannot be below the confirmed count.`
                : "Once these spots fill, later signups join the automatic first-come waitlist."
            }
          >
            <Input
              id="capacity"
              name="capacity"
              type="number"
              inputMode="numeric"
              min={Math.max(1, event?.confirmed_count ?? 0)}
              max={500}
              defaultValue={fieldValue("capacity", String(event?.capacity ?? 10))}
              aria-invalid={Boolean(errorFor(state, "capacity"))}
              required
            />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button
          render={<Link href={event ? `/events/${event.id}` : "/events"} />}
          variant="outline"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <Send data-icon="inline-start" aria-hidden="true" />
          )}
          {pending ? (event ? "Saving…" : "Publishing…") : event ? "Save changes" : "Publish event"}
        </Button>
      </div>
    </form>
  );
}
