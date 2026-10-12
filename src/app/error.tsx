"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-muted px-5 py-12"
    >
      <div className="w-full max-w-xl rounded-xl border bg-background p-7 text-center shadow-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold">This page could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The service may be temporarily unavailable. Your sign-in has been kept. Retry this page;
          if the problem continues, open NHS access help.
        </p>
        <Button type="button" onClick={retry} className="mt-6">
          Try again
        </Button>
        <a href="/access-help" className="mt-4 block text-sm font-medium text-primary underline">
          NHS access help
        </a>
      </div>
    </main>
  );
}
