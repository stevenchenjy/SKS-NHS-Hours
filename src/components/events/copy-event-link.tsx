"use client";

import { useId, useRef, useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function CopyEventLink({ eventId }: { eventId: string }) {
  const inputId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copying" | "copied">("idle");
  const [manualLink, setManualLink] = useState("");

  async function copyLink() {
    const link = new URL(`/events/${eventId}`, window.location.origin).href;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(link);
      setStatus("copied");
    } catch {
      setStatus("idle");
      setManualLink(link);
    }
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        disabled={status === "copying"}
        onClick={copyLink}
      >
        {status === "copied" ? (
          <Check data-icon="inline-start" aria-hidden="true" />
        ) : (
          <LinkIcon data-icon="inline-start" aria-hidden="true" />
        )}
        {status === "copied"
          ? "Link copied"
          : status === "copying"
            ? "Copying…"
            : "Copy signup link"}
      </Button>
      {status === "copied" ? (
        <span role="status" className="sr-only">
          Signup link copied. Paste it into your volunteer email.
        </span>
      ) : null}
      <Dialog open={Boolean(manualLink)} onOpenChange={(open) => !open && setManualLink("")}>
        <DialogContent initialFocus={inputRef} finalFocus={buttonRef}>
          <DialogHeader>
            <DialogTitle>Copy signup link</DialogTitle>
            <DialogDescription>
              Automatic copying is unavailable. Copy the link below and paste it into your volunteer
              email. Members will sign in before signing up.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={inputId}>Signup link</FieldLabel>
            <Input
              ref={inputRef}
              id={inputId}
              value={manualLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </Field>
        </DialogContent>
      </Dialog>
    </>
  );
}
