export type RecoveryProof = { code: string } | { accessToken: string; refreshToken: string };

export type RecoveryLinkResult =
  | { ok: true; proof: RecoveryProof }
  | {
      ok: false;
      reason: "invalid-password-link" | "password-link-expired";
    };

export function parseRecoveryLink(code: string | undefined, hash: string): RecoveryLinkResult {
  const normalizedCode = code?.trim();
  if (normalizedCode) return { ok: true, proof: { code: normalizedCode } };

  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (params.has("error") || params.has("error_code")) {
    return { ok: false, reason: "password-link-expired" };
  }

  const accessToken = params.get("access_token")?.trim();
  const refreshToken = params.get("refresh_token")?.trim();
  if (params.get("type") !== "recovery" || !accessToken || !refreshToken) {
    return { ok: false, reason: "invalid-password-link" };
  }

  return { ok: true, proof: { accessToken, refreshToken } };
}
