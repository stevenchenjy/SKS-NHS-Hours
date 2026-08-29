"use client";

import { useActionState } from "react";
import { FileUp, Send } from "lucide-react";

import {
  importRosterAction,
  inviteAccountAction,
  type AdminFormState,
} from "@/app/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SchoolYear } from "@/lib/types";

const initialState: AdminFormState = {};
const roles = [
  ["member", "Member"],
  ["committee_head", "Committee head"],
  ["president", "President"],
  ["vice_president", "Vice president"],
  ["teacher_admin", "Teacher administrator"],
] as const;

export function InviteAccountForm({ schoolYears }: { schoolYears: SchoolYear[] }) {
  const [state, action, pending] = useActionState(inviteAccountAction, initialState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(state.fieldErrors?.full_name)}>
            <FieldLabel htmlFor="full_name">Full name</FieldLabel>
            <Input id="full_name" name="full_name" required className="h-11" />
            <FieldError>{state.fieldErrors?.full_name?.[0]}</FieldError>
          </Field>
          <Field data-invalid={Boolean(state.fieldErrors?.email)}>
            <FieldLabel htmlFor="email">School email</FieldLabel>
            <Input id="email" name="email" type="email" required className="h-11" />
            <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
          </Field>
        </div>
        <Field data-invalid={Boolean(state.fieldErrors?.school_year_id)}>
          <FieldLabel htmlFor="school_year_id">School year</FieldLabel>
          <select
            id="school_year_id"
            name="school_year_id"
            required
            className="h-11 rounded-lg border bg-background px-3 text-sm"
          >
            {schoolYears
              .filter((year) => ["draft", "active"].includes(year.status))
              .map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label} · {year.status}
                </option>
              ))}
          </select>
          <FieldError>{state.fieldErrors?.school_year_id?.[0]}</FieldError>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Initial roles</FieldLegend>
          <FieldDescription>
            The member role is always included. Leadership expires with this membership.
          </FieldDescription>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map(([value, label]) => (
              <Field key={value} orientation="horizontal">
                <Checkbox
                  id={`invite-role-${value}`}
                  name="roles"
                  value={value}
                  defaultChecked={value === "member"}
                  disabled={value === "member"}
                />
                {value === "member" ? <input type="hidden" name="roles" value="member" /> : null}
                <FieldLabel htmlFor={`invite-role-${value}`}>{label}</FieldLabel>
              </Field>
            ))}
          </div>
          <FieldError>{state.fieldErrors?.roles?.[0]}</FieldError>
        </FieldSet>
      </FieldGroup>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        <Send data-icon="inline-start" aria-hidden="true" />
        {pending ? "Sending invitation…" : "Create and send invitation"}
      </Button>
    </form>
  );
}

export function RosterImportForm({ schoolYears }: { schoolYears: SchoolYear[] }) {
  const [state, action, pending] = useActionState(importRosterAction, initialState);
  return (
    <form action={action} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="import-school-year">School year</FieldLabel>
        <select
          id="import-school-year"
          name="school_year_id"
          required
          className="h-11 rounded-lg border bg-background px-3 text-sm"
        >
          {schoolYears
            .filter((year) => ["draft", "active"].includes(year.status))
            .map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="roster">Roster CSV</FieldLabel>
        <Input
          id="roster"
          name="roster"
          type="file"
          accept=".csv,text/csv"
          required
          className="h-11"
        />
        <FieldDescription>
          Up to 250 rows and 1 MB. Headers: email, full_name, optional roles. Separate roles with |.
        </FieldDescription>
      </Field>
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
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        <FileUp data-icon="inline-start" aria-hidden="true" />
        {pending ? "Validating and importing…" : "Validate and import roster"}
      </Button>
    </form>
  );
}
