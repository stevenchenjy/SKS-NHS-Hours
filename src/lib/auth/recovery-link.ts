export type RecoveryProof = { code: string } | { accessToken: string; refreshToken: string };

export type RecoveryLinkResult =
  | { ok: true; proof: RecoveryProof }
  | {
      ok: false;
      reason: "invalid-password-link" | "password-link-expired" | "password-verification-failed";
    };

export function parseRecoveryLink(code: string | undefined, hash: string): RecoveryLinkResult {
  const normalizedCode = code?.trim();
  if (normalizedCode) return { ok: true, proof: { code: normalizedCode } };

  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (params.has("error") || params.has("error_code")) {
    const reason = passwordLinkErrorReason(
      { code: params.get("error_code") ?? params.get("error") ?? undefined },
      "recovery",
    );
    return {
      ok: false,
      reason: reason === "password-link-expired" ? reason : "password-verification-failed",
    };
  }

  const accessToken = params.get("access_token")?.trim();
  const refreshToken = params.get("refresh_token")?.trim();
  if (params.get("type") !== "recovery" || !accessToken || !refreshToken) {
    return { ok: false, reason: "invalid-password-link" };
  }

  return { ok: true, proof: { accessToken, refreshToken } };
}
import { passwordLinkErrorReason } from "@/lib/auth/password-link-error";
