import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createPasswordUpdateContext,
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
} from "@/lib/auth/password-update-context";
import { getPasswordUpdateContextSecret } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { passwordLinkErrorReason } from "@/lib/auth/password-link-error";

const recoveryProofSchema = z.union([
  z.object({ code: z.string().min(1) }).strict(),
  z
    .object({
      accessToken: z.string().min(1),
      refreshToken: z.string().min(1),
    })
    .strict(),
]);

function errorResponse(reason: string, status = 400) {
  return NextResponse.json({ reason }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return errorResponse("invalid-password-link", 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("invalid-password-link");
  }

  const proof = recoveryProofSchema.safeParse(payload);
  if (!proof.success) return errorResponse("invalid-password-link");

  const supabase = await createSupabaseServerClient();
  let result;
  try {
    result =
      "code" in proof.data
        ? await supabase.auth.exchangeCodeForSession(proof.data.code)
        : await supabase.auth.setSession({
            access_token: proof.data.accessToken,
            refresh_token: proof.data.refreshToken,
          });
  } catch {
    return errorResponse("password-verification-failed", 503);
  }

  if (result.error || !result.data.user) {
    return errorResponse(passwordLinkErrorReason(result.error, "recovery"));
  }

  let context: string;
  try {
    context = await createPasswordUpdateContext(
      { subject: result.data.user.id, purpose: "recovery" },
      getPasswordUpdateContextSecret(),
    );
  } catch {
    await supabase.auth.signOut({ scope: "local" });
    return errorResponse("password-context-failed", 500);
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(PASSWORD_UPDATE_CONTEXT_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/update-password",
    maxAge: PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  });
  return response;
}
