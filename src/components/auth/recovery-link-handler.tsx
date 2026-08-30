"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseRecoveryLink } from "@/lib/auth/recovery-link";

const fallbackError = "invalid-password-link";

export function RecoveryLinkHandler({ code }: { code?: string }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const recoveryLink = parseRecoveryLink(code, window.location.hash);
    if (!recoveryLink.ok) {
      window.location.replace(`/login?error=${recoveryLink.reason}`);
      return;
    }
    const proof = recoveryLink.proof;

    async function verifyRecoveryLink() {
      try {
        const response = await fetch("/auth/recovery-callback/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proof),
          cache: "no-store",
        });
        const result = (await response.json()) as { reason?: string };
        if (!response.ok) {
          window.location.replace(`/login?error=${result.reason ?? fallbackError}`);
          return;
        }
        window.location.replace("/update-password");
      } catch {
        window.location.replace(`/login?error=${fallbackError}`);
      }
    }

    void verifyRecoveryLink();
  }, [code]);

  return (
    <Card className="py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <CardTitle as="h1" className="text-3xl font-bold tracking-tight">
          Verifying your reset link
        </CardTitle>
        <CardDescription className="text-base leading-6">
          Keep this page open while we securely prepare your password form.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3 px-6 py-7 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        Checking your one-time link…
      </CardContent>
    </Card>
  );
}
