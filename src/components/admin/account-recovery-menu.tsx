"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { MoreHorizontal } from "lucide-react";

import {
  generateMemberRecoveryLinkAction,
  type RecoveryLinkFormState,
} from "@/app/actions/admin-recovery-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

const initialState: RecoveryLinkFormState = {};

function RecoveryLinkForm({
  profileId,
  email,
  busyRef,
  onClose,
}: {
  profileId: string;
  email: string;
  busyRef: RefObject<boolean>;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(generateMemberRecoveryLinkAction, initialState);
  const [confirmed, setConfirmed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
  const linkId = useId();
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    busyRef.current = pending;
    return () => {
      busyRef.current = false;
    };
  }, [busyRef, pending]);

  async function copyLink() {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopyStatus("copied");
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopyStatus("manual");
    }
  }

  if (state.link) {
    return (
      <>
        <p role="status" className="text-sm leading-6">
          Link ready for <strong>{state.recipientEmail}</strong>. It can be used once and expires
          according to the portal&apos;s recovery-link setting. Send it privately to this verified
          school address.
        </p>
        <div className="space-y-2">
          <label htmlFor={linkId} className="text-sm font-medium">
            Reset link
          </label>
          <Input
            ref={linkRef}
            id={linkId}
            value={state.link}
            readOnly
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </div>
        {copyStatus === "copied" ? <p role="status">Link copied.</p> : null}
        {copyStatus === "manual" ? (
          <p role="alert">Clipboard access is unavailable. Copy the selected link manually.</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button type="button" onClick={copyLink}>
            Copy link
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      action={action}
      className="space-y-4"
      onSubmit={() => {
        busyRef.current = true;
      }}
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="expected_email" value={email} />
      <p className="text-sm leading-6">
        School email: <strong>{email}</strong>
      </p>
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
          className="mt-1.5 size-4 shrink-0 accent-primary"
        />
        <span>
          I verified who requested help and will send the link only through a school-approved
          private channel.
        </span>
      </label>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!confirmed || pending}>
          {pending ? "Generating…" : "Generate reset link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AccountRecoveryMenu({
  accountName,
  recoveryTarget,
  children,
}: {
  accountName: string;
  recoveryTarget?: { profileId: string; email: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const busyRef = useRef(false);

  function changeOpen(next: boolean) {
    if (!next && busyRef.current) return;
    setOpen(next);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <MoreHorizontal aria-hidden="true" />
          <span className="sr-only">Account actions for {accountName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {recoveryTarget ? (
            <>
              <DropdownMenuItem onClick={() => setOpen(true)}>Generate reset link</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {recoveryTarget ? (
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Reset password for {accountName}</DialogTitle>
              <DialogDescription>
                Anyone holding the one-time link can set this account&apos;s password. Confirm the
                recipient before continuing.
              </DialogDescription>
            </DialogHeader>
            {open ? (
              <RecoveryLinkForm
                profileId={recoveryTarget.profileId}
                email={recoveryTarget.email}
                busyRef={busyRef}
                onClose={() => changeOpen(false)}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
