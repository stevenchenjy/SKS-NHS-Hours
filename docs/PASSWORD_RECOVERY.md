# Invitation and password recovery

There is no shared or default portal password. Each member chooses a password after proving ownership of the email on their invitation.

## Missing reset emails

The reset action must inspect the Auth provider response. An HTTP 429 (`over_email_send_rate_limit`) means the provider rejected the request; it does not mean an email was sent. The form displays a retry/contact-adviser message. Other provider or network failures also display an error. Logs contain only the error code and status, never the address, provider message, or reset token. Unknown accounts retain the same generic response as disallowed domains.

Supabase's built-in email service has a very low project-wide quota and recipient restrictions. It is insufficient for routine school account setup. Configure a school-controlled SMTP provider in Supabase Authentication before relying on automatic invitations and password resets. Increasing an application timeout or retrying repeatedly cannot fix a provider quota.

References: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Admin-assisted recovery in the portal

For an existing, confirmed member with active school-year access, a global Admin can open **Accounts → Account actions → Generate reset link**. The dialog shows the member's school email and requires the Admin to confirm that they verified the requester and will use a school-approved private delivery channel. The link is displayed only in that dialog; closing it clears the portal's copy. Send it to the verified school address, and have the member open it and choose their own password. Do not open the link on the member's behalf.

This action is unavailable for teachers, administrators as recipients, inactive or expired members, and pending invitations. Use **Resend** for pending invitations. The database permits one request per member every 15 minutes and at most ten requests per Admin per hour. It records the Admin, target, time, and generation outcome without storing the link or token. Generating a new recovery proof invalidates an earlier one, so ask the member to use the most recent link.

The link uses `/auth/confirm?type=recovery&token_hash=...`, which first shows the non-consuming confirmation page. Its actual lifetime is controlled by the hosted Supabase Email OTP Expiration setting. The browser clipboard can retain a copied link after the dialog closes, so handle it as a password credential.

Deploy `20260923010000_admin_member_recovery_links.sql` before releasing the portal action. Verify the hosted secret key, canonical application URL, and recovery expiry setting with a synthetic member before allowing school use.

## Operator fallback outside the portal

An authorized system operator can generate a recovery link for an existing member with the server-only Supabase Admin `generateLink({ type: "recovery", email })` API. This generates a one-time proof without sending an email. Deliver it privately to the member's verified school address using the school's normal communication channel. Do not set a shared password or place a live link in source control, logs, tickets, or public messages.

Use the returned `properties.hashed_token` to build a link at the canonical portal origin:

```text
/auth/confirm?type=recovery&token_hash=<generated hashed_token>
```

Do not open or submit the recipient's password setup form as a test. The member must choose their own password. The generated link expires according to the hosted Auth email OTP setting; generating another link invalidates the previous recovery proof. This is a manual fallback, so self-service email recovery still needs SMTP.

Reference: [Supabase Admin generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

## Invitation opens as expired or already used

Check the Auth confirmation timestamp and application invitation status before assuming a link expired. Reopening a successfully consumed link produces the same verification error as an expired link. Email security scanners can consume links that verify on GET.

The portal now handles token-hash links in two steps:

1. `GET` or `HEAD /auth/confirm` opens `/confirm-email` without verifying or consuming the token.
2. The member selects **Continue to set password**. A same-origin `POST /auth/confirm` verifies the token, checks application access, and issues the signed 30-minute password context. A 303 redirect opens the password form.

Use the checked-in `supabase/templates/invite.html` and `supabase/templates/recovery.html` in the hosted Auth settings. Stock `{{ .ConfirmationURL }}` templates send readers to Supabase verification first and therefore do not gain the portal's protection against GET prefetching. Changing templates only affects future messages; existing consumed links require fresh recovery proof.

Supabase currently rejects template edits for free-tier projects using its default email provider. Configure custom SMTP or an eligible plan before applying these templates. Until then, operator-generated links can target the portal confirmation route directly without an email-template change.

The confirmation page strips token-bearing paths from referrers while retaining the origin needed for form submission checks. Redirects use the configured canonical application origin.

The forgot-password page renders per request so its scripts receive the CSP nonce created by the proxy. A static build of this page has no matching nonce and can have its JavaScript blocked by the browser.

## Verification

- Unit coverage checks provider quota/rejection/network failures, normalized email input, and generic non-account responses.
- Route coverage checks non-consuming previews, same-origin verification, expired/used tokens, application access, and signed password context creation.
- Browser checks should exercise the complete invitation/recovery → confirmation button → password update → sign-in flow, plus a provider quota response. Use local synthetic accounts or a local Auth mock so validation does not send real emails or change a student's password.
