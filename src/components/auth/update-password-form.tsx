"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { updatePasswordAction, type AuthFormState } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS } from "@/lib/auth/password-policy";
import { PasswordInput } from "@/components/auth/password-input";

const initialState: AuthFormState = {};

export function UpdatePasswordForm({
  requiresVerification = false,
  emailRecoveryEnabled = true,
}: {
  requiresVerification?: boolean;
  emailRecoveryEnabled?: boolean;
}) {
  const [state, action, pending] = useActionState(updatePasswordAction, {
    ...initialState,
    requiresPasswordVerification: emailRecoveryEnabled && requiresVerification,
  });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  return (
    <form action={action} className="space-y-5" noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            required
            className="h-11"
          />
          <FieldDescription>{PASSWORD_REQUIREMENTS}</FieldDescription>
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
        </Field>
        <Field data-invalid={Boolean(state.fieldErrors?.confirmation)}>
          <FieldLabel htmlFor="confirmation">Confirm password</FieldLabel>
          <PasswordInput
            id="confirmation"
            name="confirmation"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.confirmation)}
            required
            className="h-11"
          />
          <FieldError>{state.fieldErrors?.confirmation?.[0]}</FieldError>
        </Field>
        {emailRecoveryEnabled &&
        state.requiresPasswordVerification &&
        !state.requiresNewPasswordLink ? (
          <Field data-invalid={Boolean(state.fieldErrors?.verificationCode)}>
            <FieldLabel htmlFor="verification-code">Verification code</FieldLabel>
            <Input
              id="verification-code"
              name="verificationCode"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={128}
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              aria-invalid={Boolean(state.fieldErrors?.verificationCode)}
              required
              className="h-11"
            />
            <FieldDescription>
              Use the latest code sent to your account email. Keep this password form open.
            </FieldDescription>
            <FieldError>{state.fieldErrors?.verificationCode?.[0]}</FieldError>
          </Field>
        ) : null}
      </FieldGroup>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.requiresNewPasswordLink ? (
        <Link
          href={emailRecoveryEnabled ? "/forgot-password" : "/login?next=/update-password"}
          className="block text-sm font-medium text-primary underline"
        >
          {emailRecoveryEnabled ? "Request a new reset link" : "Verify again with school Google"}
        </Link>
      ) : null}
      {state.message ? (
        <p role="status" className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="h-11 w-full"
        disabled={pending || state.requiresNewPasswordLink}
      >
        {pending ? "Updating…" : "Update password"}
      </Button>
      {emailRecoveryEnabled &&
      state.requiresPasswordVerification &&
      !state.requiresNewPasswordLink ? (
        <Button
          type="submit"
          name="intent"
          value="resend-verification-code"
          variant="outline"
          className="w-full"
          disabled={pending}
          formNoValidate
          onClick={() => setVerificationCode("")}
        >
          Resend verification code
        </Button>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        Correct any errors and retry here. You can return to /update-password in this browser while
        this setup session is valid. Once saved, you will enter the portal automatically.
      </p>
      <Link href="/login" className="text-sm font-medium text-primary underline">
        Already know your password? Back to sign in
      </Link>
    </form>
  );
}
