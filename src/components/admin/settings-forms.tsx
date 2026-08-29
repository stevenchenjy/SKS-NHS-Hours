"use client";

import { useActionState } from "react";
import { CheckCircle2, Plus } from "lucide-react";

import {
  createSchoolYearAction,
  renewMembershipAction,
  setSchoolYearCategoryAction,
  setTargetAction,
  upsertCategoryAction,
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
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AccountDirectoryRecord, Membership, SchoolYear, ServiceCategory } from "@/lib/types";

const initialState: AdminFormState = {};
const roleOptions = [
  ["member", "Member"],
  ["committee_head", "Committee head"],
  ["president", "President"],
  ["vice_president", "Vice president"],
  ["teacher_admin", "Teacher administrator"],
] as const;

export function CreateSchoolYearForm() {
  const [state, action, pending] = useActionState(createSchoolYearAction, initialState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="label">Label</FieldLabel>
          <Input id="label" name="label" placeholder="2027-2028" required className="h-11" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="start_date">Start date</FieldLabel>
            <Input id="start_date" name="start_date" type="date" required className="h-11" />
          </Field>
          <Field>
            <FieldLabel htmlFor="end_date">End date</FieldLabel>
            <Input id="end_date" name="end_date" type="date" required className="h-11" />
          </Field>
        </div>
        <Field data-invalid={Boolean(state.fieldErrors?.default_target_hours)}>
          <FieldLabel htmlFor="default_target_hours">Default annual target</FieldLabel>
          <Input
            id="default_target_hours"
            name="default_target_hours"
            type="number"
            min="0"
            step="0.25"
            defaultValue="20"
            required
            className="h-11 max-w-40"
          />
          <FieldError>{state.fieldErrors?.default_target_hours?.[0]}</FieldError>
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
      <Button type="submit" disabled={pending}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        {pending ? "Creating…" : "Create draft school year"}
      </Button>
    </form>
  );
}

export function RenewMembershipForm({
  years,
  accounts,
}: {
  years: SchoolYear[];
  accounts: AccountDirectoryRecord[];
}) {
  const [state, action, pending] = useActionState(renewMembershipAction, initialState);
  return (
    <form action={action} className="space-y-6" noValidate>
      <div className="grid gap-6 lg:grid-cols-2">
        <FieldGroup>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">1 · Select</p>
            <h3 className="mt-1 font-semibold">User and destination year</h3>
          </div>
          <Field>
            <FieldLabel htmlFor="renew-profile">User</FieldLabel>
            <select
              id="renew-profile"
              name="profile_id"
              required
              className="h-11 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Choose a user</option>
              {accounts.map(({ profile }) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name} · {profile.email}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="renew-year">New school year</FieldLabel>
            <select
              id="renew-year"
              name="school_year_id"
              required
              className="h-11 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Choose a draft or active year</option>
              {years
                .filter((year) => ["draft", "active"].includes(year.status))
                .map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label} · {year.status}
                  </option>
                ))}
            </select>
          </Field>
        </FieldGroup>

        <FieldGroup>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">2 · Access</p>
            <h3 className="mt-1 font-semibold">Expiration and target</h3>
          </div>
          <Field>
            <FieldLabel htmlFor="expiration_date">Expiration date</FieldLabel>
            <Input
              id="expiration_date"
              name="expiration_date"
              type="date"
              required
              className="h-11"
            />
            <FieldDescription>Usually the destination school year’s end date.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="renew-target">Target override</FieldLabel>
            <Input
              id="renew-target"
              name="target_hours_override"
              type="number"
              min="0"
              step="0.25"
              className="h-11"
              placeholder="Leave blank for the year default"
            />
          </Field>
        </FieldGroup>
      </div>

      <FieldSet className="border-t pt-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">3 · Roles</p>
          <FieldLegend className="mt-1">Assign school-year roles</FieldLegend>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {roleOptions.map(([value, label]) => (
            <Field key={value} orientation="horizontal">
              <Checkbox
                id={`renew-role-${value}`}
                name="roles"
                value={value}
                defaultChecked={value === "member"}
                disabled={value === "member"}
              />
              {value === "member" ? <input type="hidden" name="roles" value="member" /> : null}
              <FieldLabel htmlFor={`renew-role-${value}`}>{label}</FieldLabel>
            </Field>
          ))}
        </div>
      </FieldSet>

      <Field orientation="horizontal" className="rounded-xl border bg-muted/45 p-4">
        <Checkbox id="confirm-renewal" required />
        <FieldLabel htmlFor="confirm-renewal">
          <span>
            <strong>4 · Review summary and confirm.</strong>
            <span className="block text-sm font-normal text-muted-foreground">
              The previous membership remains read-only; this creates or reactivates a distinct
              destination-year membership.
            </span>
          </span>
        </FieldLabel>
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
      <Button type="submit" size="lg" disabled={pending}>
        <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
        {pending ? "Creating membership…" : "5 · Create membership"}
      </Button>
    </form>
  );
}

export function CategoryForm({
  category,
}: {
  category?: ServiceCategory & { default_max_hours_per_request?: string | number | null };
}) {
  const [state, action, pending] = useActionState(upsertCategoryAction, initialState);
  return (
    <form
      action={action}
      className="grid gap-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)_100px_150px_120px_auto] lg:items-end"
    >
      <input type="hidden" name="category_id" value={category?.id ?? ""} />
      <Field>
        <FieldLabel htmlFor={`name-${category?.id ?? "new"}`}>Name</FieldLabel>
        <Input
          id={`name-${category?.id ?? "new"}`}
          name="name"
          defaultValue={category?.name}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`description-${category?.id ?? "new"}`}>Description</FieldLabel>
        <Input
          id={`description-${category?.id ?? "new"}`}
          name="description"
          defaultValue={category?.description ?? ""}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`order-${category?.id ?? "new"}`}>Order</FieldLabel>
        <Input
          id={`order-${category?.id ?? "new"}`}
          name="display_order"
          type="number"
          min="0"
          defaultValue={category?.display_order ?? 0}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`cap-${category?.id ?? "new"}`}>Per-request cap</FieldLabel>
        <Input
          id={`cap-${category?.id ?? "new"}`}
          name="default_max_hours_per_request"
          type="number"
          min="0.25"
          max="24"
          step="0.25"
          defaultValue={category?.default_max_hours_per_request ?? ""}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`active-${category?.id ?? "new"}`}>Status</FieldLabel>
        <select
          id={`active-${category?.id ?? "new"}`}
          name="is_active"
          defaultValue={category?.is_active === false ? "false" : "true"}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </Field>
      <Button type="submit" variant={category ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : category ? "Update" : "Add category"}
      </Button>
      {state.error || state.message ? (
        <p
          className={`text-sm lg:col-span-full ${state.error ? "text-destructive" : "text-primary"}`}
        >
          {state.error ?? state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SchoolYearCategoryForm({
  schoolYearId,
  category,
  setting,
}: {
  schoolYearId: string;
  category: ServiceCategory;
  setting?: {
    is_available: boolean;
    display_order: number;
    max_hours_per_request: string | number | null;
    member_approved_hours_cap: string | number | null;
  };
}) {
  const [state, action, pending] = useActionState(setSchoolYearCategoryAction, initialState);
  return (
    <form
      action={action}
      className="grid gap-3 border-t py-4 first:border-t-0 sm:grid-cols-[minmax(180px,1fr)_120px_120px_150px_auto] sm:items-end"
    >
      <input type="hidden" name="school_year_id" value={schoolYearId} />
      <input type="hidden" name="category_id" value={category.id} />
      <div>
        <p className="font-semibold">{category.name}</p>
        <p className="text-xs text-muted-foreground">{category.description}</p>
      </div>
      <Field>
        <FieldLabel htmlFor={`year-order-${category.id}`}>Order</FieldLabel>
        <Input
          id={`year-order-${category.id}`}
          name="display_order"
          type="number"
          min="0"
          defaultValue={setting?.display_order ?? category.display_order}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`year-limit-${category.id}`}>Request cap</FieldLabel>
        <Input
          id={`year-limit-${category.id}`}
          name="max_hours_per_request"
          type="number"
          min="0.25"
          max="24"
          step="0.25"
          defaultValue={setting?.max_hours_per_request ?? ""}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`member-cap-${category.id}`}>Member annual cap</FieldLabel>
        <Input
          id={`member-cap-${category.id}`}
          name="member_approved_hours_cap"
          type="number"
          min="0.25"
          step="0.25"
          defaultValue={setting?.member_approved_hours_cap ?? ""}
        />
      </Field>
      <div className="flex items-center gap-2">
        <select
          name="is_available"
          defaultValue={setting?.is_available === false ? "false" : "true"}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="true">Available</option>
          <option value="false">Unavailable</option>
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
      {state.error || state.message ? (
        <p
          className={`text-sm sm:col-span-full ${state.error ? "text-destructive" : "text-primary"}`}
        >
          {state.error ?? state.message}
        </p>
      ) : null}
    </form>
  );
}

export function TargetOverrideForm({ membership }: { membership: Membership }) {
  const [state, action, pending] = useActionState(setTargetAction, initialState);
  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="membership_id" value={membership.id} />
      <Field>
        <FieldLabel htmlFor={`target-${membership.id}`} className="sr-only">
          Target override
        </FieldLabel>
        <Input
          id={`target-${membership.id}`}
          name="target_hours_override"
          type="number"
          min="0"
          step="0.25"
          defaultValue={membership.target_hours_override ?? ""}
          placeholder="Year default"
          className="w-32"
        />
      </Field>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Save
      </Button>
      {state.error ? (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
