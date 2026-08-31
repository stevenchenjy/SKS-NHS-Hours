"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function EventActionSubmit({
  label,
  pendingLabel,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}
