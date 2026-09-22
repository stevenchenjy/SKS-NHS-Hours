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
          aria-invalid={Boolean(state.fieldErrors?.email)}
          className="h-11"
        />
        <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
      </Field>
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
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        <Mail data-icon="inline-start" aria-hidden="true" />
        {pending ? "Sending…" : "Send reset instructions"}
      </Button>
      <p className="text-sm leading-6 text-muted-foreground">
        Use the school email from your invitation and check your spam or junk folder. If no email
        arrives, contact the portal admin to check your account and email delivery.
      </p>
    </form>
  );
}
