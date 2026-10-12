"use client";

import { useActionState } from "react";
import { retryPortalAccessAction, type AuthFormState } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";

export function AccessRetryForm() {
  const [state, action, pending] = useActionState(retryPortalAccessAction, {} as AuthFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking access…" : "Retry NHS access"}
      </Button>
    </form>
  );
}
