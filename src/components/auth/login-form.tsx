"use client";

import { useActionState, useState } from "react";
import { LogIn } from "lucide-react";

import { loginAction, type AuthFormState } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";

const initialState: AuthFormState = {};

export function LoginForm({ next = "/dashboard" }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">School email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
            className="h-11"
          />
          <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            id="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
            className="h-11"
          />
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
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
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        <LogIn data-icon="inline-start" aria-hidden="true" />
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
