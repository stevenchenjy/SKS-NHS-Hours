"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";

import { forgotPasswordAction, type AuthFormState } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <Field data-invalid={Boolean(state.fieldErrors?.email)}>
        <FieldLabel htmlFor="email">School email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11"
        />
        <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
      </Field>
      {state.message ? (
        <p role="status" className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        <Mail data-icon="inline-start" aria-hidden="true" />
        {pending ? "Sending…" : "Send reset instructions"}
      </Button>
    </form>
  );
}
