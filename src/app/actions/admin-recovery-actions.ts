"use server";

import { z } from "zod";

import { requireAdmin } from "@/lib/dal/access";
import { assertAllowedEmail, getServerEnvironment } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface RecoveryLinkFormState {
  link?: string;
  recipientEmail?: string;
  error?: string;
}

const reservationSchema = z.object({
  attempt_id: z.coerce.number().int().safe().positive(),
  recipient_email: z.email(),
});

const unavailableMessage = "The reset link could not be generated. Try again later.";

function reservationErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === "22023") return "This account is not eligible for a reset link.";
  if (error.code === "P0001") {
    if (error.message?.includes("Wait 15 minutes")) {
      return "A reset link was requested recently. Wait 15 minutes before generating another.";
    }
    if (error.message?.includes("hourly reset-link limit")) {
      return "The hourly reset-link limit was reached. Try again later.";
    }
  }
  return unavailableMessage;
}

export async function generateMemberRecoveryLinkAction(
  _previous: RecoveryLinkFormState,
  formData: FormData,
): Promise<RecoveryLinkFormState> {
  await requireAdmin();
  const profileId = z.uuid().safeParse(formData.get("profile_id"));
  if (!profileId.success) return { error: "This account could not be identified." };
  const expectedEmail = z.email().safeParse(formData.get("expected_email"));
  if (!expectedEmail.success) return { error: "Refresh the account list and try again." };

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { error: unavailableMessage };
  }

  let reservation: unknown;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("reserve_member_recovery_link", {
      p_profile_id: profileId.data,
    });
    if (error) return { error: reservationErrorMessage(error) };
    reservation = Array.isArray(data) ? data[0] : data;
  } catch {
    return { error: unavailableMessage };
  }

  const parsed = reservationSchema.safeParse(reservation);
  if (!parsed.success) return { error: unavailableMessage };

  let link: string | undefined;
  let failureMessage = unavailableMessage;
  if (expectedEmail.data.toLowerCase() !== parsed.data.recipient_email.toLowerCase()) {
    failureMessage =
      "The account email changed. Refresh the account list before generating a link.";
  } else {
    try {
      const environment = getServerEnvironment();
      assertAllowedEmail(parsed.data.recipient_email, environment.allowedEmailDomains);
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: parsed.data.recipient_email,
      });
      if (error) {
        // Provider messages can contain addresses or tokens; log only safe fields.
        console.error("Admin recovery link generation failed", {
          code: error.code,
          status: error.status,
        });
      } else if (
        data?.user?.id === profileId.data &&
        data.properties?.verification_type === "recovery" &&
        data.properties.hashed_token
      ) {
        const url = new URL("/auth/confirm", environment.NEXT_PUBLIC_APP_URL);
        url.searchParams.set("type", "recovery");
        url.searchParams.set("token_hash", data.properties.hashed_token);
        link = url.toString();
      }
    } catch {
      console.error("Admin recovery link generation failed", { code: "request_failed" });
    }
  }

  try {
    const { error } = await admin.rpc("complete_member_recovery_link", {
      p_attempt_id: parsed.data.attempt_id,
      p_succeeded: Boolean(link),
    });
    if (error) {
      console.error("Admin recovery link audit failed", { code: error.code });
      return { error: unavailableMessage };
    }
  } catch {
    console.error("Admin recovery link audit failed", { code: "request_failed" });
    return { error: unavailableMessage };
  }

  return link ? { link, recipientEmail: parsed.data.recipient_email } : { error: failureMessage };
}
