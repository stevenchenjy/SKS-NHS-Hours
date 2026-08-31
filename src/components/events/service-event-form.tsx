"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LoaderCircle, Send } from "lucide-react";

import { createServiceEventAction, type ServiceEventFormState } from "@/app/actions/event-actions";
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
}: {
  schoolYearId: string;
  contactName: string;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState(createServiceEventAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="school_year_id" value={schoolYearId} />
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
              aria-invalid={Boolean(errorFor(state, "description"))}
              required
            />
          </FormField>
          <FormField name="volunteer_audience" label="Who should volunteer?" state={state}>
            <Input
              id="volunteer_audience"
              name="volunteer_audience"
              maxLength={500}
              defaultValue="All active NHS members"
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
              aria-invalid={Boolean(errorFor(state, "location"))}
              required
            />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField name="starts_at" label="Starts" state={state}>
              <Input
                id="starts_at"
                name="starts_at"
                type="datetime-local"
                aria-invalid={Boolean(errorFor(state, "starts_at"))}
                required
              />
            </FormField>
            <FormField name="ends_at" label="Ends" state={state}>
              <Input
                id="ends_at"
                name="ends_at"
                type="datetime-local"
                aria-invalid={Boolean(errorFor(state, "ends_at"))}
                required
              />
            </FormField>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Contact and capacity</FieldLegend>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField name="contact_name" label="Contact person" state={state}>
              <Input
                id="contact_name"
                name="contact_name"
                maxLength={200}
                defaultValue={contactName}
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
                defaultValue={contactEmail}
                aria-invalid={Boolean(errorFor(state, "contact_email"))}
                required
              />
            </FormField>
          </div>
          <FormField
            name="capacity"
            label="People needed"
            state={state}
            description="Once these spots fill, later signups join the automatic first-come waitlist."
          >
            <Input
              id="capacity"
              name="capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              defaultValue={10}
              aria-invalid={Boolean(errorFor(state, "capacity"))}
              required
            />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
        <Button render={<Link href="/events" />} variant="outline">
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <Send data-icon="inline-start" aria-hidden="true" />
          )}
          {pending ? "Publishing…" : "Publish event"}
        </Button>
      </div>
    </form>
  );
}
