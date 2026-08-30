"use client";

import { useActionState } from "react";
import { FileUp, Send } from "lucide-react";

import {
  addExistingAccountToSchoolYearAction,
  importRosterAction,
  inviteAccountAction,
  type AdminFormState,
} from "@/app/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AccountDirectoryRecord, SchoolYear } from "@/lib/types";

const initialState: AdminFormState = {};
const memberAccessOptions = [
  ["member", "Member"],
  ["committee_head", "Committee head"],
  ["president_vice_president", "President / Vice President"],
] as const;

export function InviteAccountForm({
  schoolYears,
  allowTeacherAdmin,
  defaultSchoolYearId,
}: {
  schoolYears: SchoolYear[];
  allowTeacherAdmin: boolean;
  defaultSchoolYearId?: string;
}) {
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
            defaultValue={defaultSchoolYearId}
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
        <Field data-invalid={Boolean(state.fieldErrors?.access_level)}>
          <FieldLabel htmlFor="invite-access-level">Initial access</FieldLabel>
          <select
            id="invite-access-level"
            name="access_level"
            defaultValue="member"
            required
            className="h-11 rounded-lg border bg-background px-3 text-sm"
          >
            {memberAccessOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {allowTeacherAdmin ? (
              <option value="teacher_admin">Teacher administrator</option>
            ) : null}
          </select>
          <FieldDescription>
            Choose one starting access level. Leadership follows the selected school year; teacher
            administrator access is global and does not create a member requirement.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.access_level?.[0]}</FieldError>
        </Field>
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

export function AddExistingAccountForm({
  schoolYears,
  accounts,
  defaultProfileId,
  defaultSchoolYearId,
}: {
  schoolYears: SchoolYear[];
  accounts: AccountDirectoryRecord[];
  defaultProfileId?: string;
  defaultSchoolYearId?: string;
}) {
  const [state, action, pending] = useActionState(
    addExistingAccountToSchoolYearAction,
    initialState,
  );
  const ordinaryAccounts = accounts.filter(
    (account) => account.globalAccessLevel === null && account.profile.status === "active",
  );

  return (
    <form action={action} className="space-y-5" noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.profile_id)}>
          <FieldLabel htmlFor="existing-profile">Existing account</FieldLabel>
          <select
            id="existing-profile"
            name="profile_id"
            defaultValue={defaultProfileId ?? ""}
            required
            className="h-11 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">Choose an account</option>
            {ordinaryAccounts.map(({ profile }) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name} · {profile.email}
              </option>
            ))}
          </select>
          <FieldError>{state.fieldErrors?.profile_id?.[0]}</FieldError>
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.school_year_id)}>
          <FieldLabel htmlFor="existing-school-year">School year</FieldLabel>
          <select
            id="existing-school-year"
            name="school_year_id"
            defaultValue={defaultSchoolYearId ?? ""}
            required
            className="h-11 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">Choose a draft or active year</option>
            {schoolYears
              .filter((year) => ["draft", "active"].includes(year.status))
              .map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label} · {year.status}
                </option>
              ))}
          </select>
          <FieldDescription>
            Access expires at the school year end, and the service requirement is fixed at 20 hours.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.school_year_id?.[0]}</FieldError>
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.access_level)}>
          <FieldLabel htmlFor="existing-access-level">School-year access</FieldLabel>
          <select
            id="existing-access-level"
            name="access_level"
            defaultValue="member"
            required
            className="h-11 rounded-lg border bg-background px-3 text-sm"
          >
            {memberAccessOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError>{state.fieldErrors?.access_level?.[0]}</FieldError>
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
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        {pending ? "Adding access…" : "Add to school year"}
      </Button>
    </form>
  );
}

export function RosterImportForm({
  schoolYears,
  defaultSchoolYearId,
}: {
  schoolYears: SchoolYear[];
  defaultSchoolYearId?: string;
}) {
  const [state, action, pending] = useActionState(importRosterAction, initialState);
  return (
    <form action={action} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="import-school-year">School year</FieldLabel>
        <select
          id="import-school-year"
          name="school_year_id"
          defaultValue={defaultSchoolYearId}
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
          Up to 250 rows and 1 MB. Headers: email, full_name, and optional roles. Use one value:
          member, committee_head, or president_vice_president. Teacher administrators must be
          granted individually by a platform owner.
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
