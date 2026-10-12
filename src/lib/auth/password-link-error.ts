/** Provider outages must not be reported as expired one-time links. */
export function passwordLinkErrorReason(
  error: { code?: string } | null,
  purpose: "invite" | "recovery",
): string {
  if (
    [
      "otp_expired",
      "invite_not_found",
      "flow_state_expired",
      "flow_state_not_found",
      "bad_code_verifier",
      "invalid_credentials",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "session_expired",
      "session_not_found",
      "bad_jwt",
    ].includes(error?.code ?? "")
  ) {
    return purpose === "invite" ? "invitation-link-expired" : "password-link-expired";
  }
  return "password-verification-failed";
}
