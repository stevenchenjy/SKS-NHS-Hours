"use client";

import { useActionState } from "react";
import { Plus, Save } from "lucide-react";

import {
  createSchoolYearAction,
  setSchoolYearCategoryAction,
  updateSchoolYearDatesAction,
  upsertCategoryAction,
  type AdminFormState,
} from "@/app/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ServiceCategory } from "@/lib/types";

const initialState: AdminFormState = {};

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

export function SchoolYearDatesForm({
  schoolYear,
}: {
  schoolYear: { id: string; label: string; start_date: string; end_date: string };
}) {
  const [state, action, pending] = useActionState(updateSchoolYearDatesAction, initialState);
  const [startYear, endYear] = schoolYear.label.split("-");

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="school_year_id" value={schoolYear.id} />
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(state.fieldErrors?.start_date)}>
          <FieldLabel htmlFor={`start-date-${schoolYear.id}`}>Start date</FieldLabel>
          <Input
            id={`start-date-${schoolYear.id}`}
            name="start_date"
            type="date"
            defaultValue={schoolYear.start_date}
            min={`${startYear}-01-01`}
            max={`${startYear}-12-31`}
            required
            aria-invalid={Boolean(state.fieldErrors?.start_date)}
          />
          <FieldError>{state.fieldErrors?.start_date?.[0]}</FieldError>
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.end_date)}>
          <FieldLabel htmlFor={`end-date-${schoolYear.id}`}>End date</FieldLabel>
          <Input
            id={`end-date-${schoolYear.id}`}
            name="end_date"
            type="date"
            defaultValue={schoolYear.end_date}
            min={`${endYear}-01-01`}
            max={`${endYear}-12-31`}
            required
            aria-invalid={Boolean(state.fieldErrors?.end_date)}
          />
          <FieldError>{state.fieldErrors?.end_date?.[0]}</FieldError>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <Save data-icon="inline-start" aria-hidden="true" />
          {pending ? "Saving…" : "Save dates"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p role="status" className="text-sm text-primary">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function CategoryForm({ category }: { category?: ServiceCategory }) {
  const [state, action, pending] = useActionState(upsertCategoryAction, initialState);
  return (
    <form
      action={action}
      className="grid gap-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)_120px_auto] lg:items-end"
    >
      <input type="hidden" name="category_id" value={category?.id ?? ""} />
      <Field data-invalid={Boolean(state.fieldErrors?.name)}>
        <FieldLabel htmlFor={`name-${category?.id ?? "new"}`}>Name</FieldLabel>
        <Input
          id={`name-${category?.id ?? "new"}`}
          name="name"
          defaultValue={category?.name}
          maxLength={120}
          required
        />
        <FieldError>{state.fieldErrors?.name?.[0]}</FieldError>
      </Field>
      <Field data-invalid={Boolean(state.fieldErrors?.description)}>
        <FieldLabel htmlFor={`description-${category?.id ?? "new"}`}>Description</FieldLabel>
        <Input
          id={`description-${category?.id ?? "new"}`}
          name="description"
          defaultValue={category?.description ?? ""}
          maxLength={2000}
        />
        <FieldError>{state.fieldErrors?.description?.[0]}</FieldError>
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
  };
}) {
  const [state, action, pending] = useActionState(setSchoolYearCategoryAction, initialState);
  return (
    <form
      action={action}
      className="grid gap-3 border-t py-4 first:border-t-0 sm:grid-cols-[minmax(180px,1fr)_auto] sm:items-center"
    >
      <input type="hidden" name="school_year_id" value={schoolYearId} />
      <input type="hidden" name="category_id" value={category.id} />
      <div>
        <p className="font-semibold">{category.name}</p>
        <p className="text-xs text-muted-foreground">{category.description}</p>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <label htmlFor={`year-availability-${category.id}`} className="sr-only">
          Availability for {category.name}
        </label>
        <select
          id={`year-availability-${category.id}`}
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
