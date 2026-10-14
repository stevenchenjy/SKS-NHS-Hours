# School Google sign-in: isolated closed beta

## Outcome and release boundary

Students should enter the NHS portal with their school Google account, keep a six-character password fallback, and recover access without administrator-dependent email loops. Roster membership and approval permissions still decide portal access. A working Google account alone grants no role.

This branch is a candidate for a **separate closed beta**, not a production deployment. Do not promote it to the current production origin or point the beta at the production Supabase project. Current members' accounts, pending invitations, recovery proofs, cookies, and service records must remain untouched while volunteers test.

The initial approved tester is `junyuc2027@sks.org`. Use that address as the beta's temporary support contact and provision **Admin** access in the beta only. Do not change Junyu's production role. `mlaird@sks.org` is a future handoff contact, not the active support mailbox for this beta. Do not send invitations or beta announcements without a separate instruction to send them.

## Application gates

| Input                                | Behavior                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_GOOGLE_MODE=disabled` or unset | Google button and OAuth initiation/callback are disabled; ordinary password and invitation workflows remain available. The old `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` switch is ignored.      |
| `AUTH_GOOGLE_MODE=beta`              | Require exact school domains, a nonempty tester list, a different Supabase origin from production, and local or Vercel Preview execution.                                                |
| `AUTH_BETA_ALLOWED_EMAILS`           | Enforced before password sign-in/recovery and after Google identity verification; portal access checks also enforce it for preexisting/direct Auth sessions. The list stays server-side. |
| `AUTH_BETA_EMAIL_ENABLED=false`      | Only in beta, suppress email recovery, verification-code sending, invitations, imports, and resend. Use Google to recover access and set an optional password from My profile.           |
| `GOOGLE_AUTH_ALLOWED_DOMAINS`        | Enforced on the verified Google email at the callback. Google's `hd` parameter is only a hint.                                                                                           |
| `AUTH_GOOGLE_MODE=enabled`           | Requires `AUTH_GOOGLE_BETA_APPROVED=true`, set only after recorded real-person beta approval. Roster/profile checks continue.                                                            |
| `NHS_SUPPORT_EMAIL`                  | Renders a working support mail link. If omitted, the UI refers to the NHS adviser without inventing a mailbox.                                                                           |

Use `.env.beta.example` as the preview template. All beta secrets and keys must be new and restricted to the beta project. A beta configuration using the production Supabase URL fails closed. Never enable `NHS_DESIGN_PREVIEW` on a remote deployment.

## Hosted preparation status — October 13, 2026

A separate Vercel project, **sks-nhs-hours-login-beta**, has been created. Its origin is `https://sks-nhs-hours-login-beta.vercel.app`. Vercel Authentication is configured with Standard Protection, the runtime is Node 24, and all fourteen environment variables apply only to Preview. They include Junyu's server-side tester allowlist and temporary support contact, new beta Supabase credentials and password-context signing secret, the email-disabled pilot flag, and the public production Supabase origin used solely as an isolation guard. No Git auto-deploy connection or Production environment variables were added to this project.

The independent account `stevenchenjy326@gmail.com` now owns the Free organization **SKS NHS Login Beta** (`xbtqurmkkvmungpylgld`) and its new project **SKS-NHS-Hours-Login-Beta** (`xapmsimnbsrojaknpkbn`, Canada Central, nano). Creation succeeded without changing either existing project. All 29 repository migrations were applied and their original versions were verified. No development seed, production records, or production Auth users were copied.

The hosted beta now requires six characters with no character-type requirements, uses `mailer_otp_exp: 172800` for 48-hour email proofs, disables the additional password-change email challenge, requires email ownership, and disables public signup and anonymous users. The Site URL and three exact application redirects use only the beta origin. Junyu is the only beta Auth identity and has an active profile with `platform_owner` Admin access, created through the protected bootstrap RPC. The identity remains unconfirmed; no password was chosen or delivered, and no verified password-setup milestone exists. A real Google or verified-link flow must prove ownership before login. An Auth password hash created during account provisioning is not evidence that Junyu set a fallback password.

The Google Cloud project **SKS NHS Login Beta** (`sks-nhs-login-beta`) was created under `stevenchenjy326@gmail.com`, without activating billing or a paid trial. Cloud account terms are accepted. The Google Auth Platform branding form is prepared with External/testing audience, but its separate Google API Services User Data Policy agreement still awaits confirmation. The OAuth Web client, its exact beta callback, basic scopes, and Junyu-only test-user list remain to be saved and connected to Supabase.

**The Google pilot login application is not deployed or ready for login yet.** The pilot-specific read-only preflight currently fails only on the missing Google provider. The full onboarding preflight additionally reports SMTP/capacity and both email templates. Supabase rejected template changes while this Free project uses its default email provider; configure custom SMTP before applying scanner-safe templates or enabling email. The pilot sets `AUTH_BETA_EMAIL_ENABLED=false`: unavailable email actions stop before delivery, code requests, or invitation/import changes, and the UI directs the tester to school Google. Password sign-in and Google-authorized six-character password setup remain available. A completed Google-only pilot does not prove school email onboarding is ready.

Vercel coerced the explicit first Preview request to Production. The first deployment therefore serves only a harmless static setup page with no portal code or student-data connection (`dpl_9chys255EkEHkSbvPy29RiwUTZpy`). The canonical beta URL currently shows that setup page. Next.js project settings were restored for the subsequent application Preview. This is a beta-project bootstrap receipt, not an NHS app release; the production NHS project was not deployed.

The ignored `.beta-setup/` directory contains private resource/configuration receipts and isolated source staging with a beta-only Vercel project link. Its setup access token is limited to the new organization and expires after 24 hours; it is never a deployed application secret. Keep deployment operations in that staging directory; the repository root still has its existing production project link. After connecting actual Google credentials, run the Google-pilot preflight, deploy the application to **Preview**, inspect the actual deployment target, and verify `VERCEL_ENV=preview` and alias routing before issuing a test link. Standard Protection excludes production project domains, so inspect the canonical alias without cookies rather than assuming it has a Vercel gate. The application's verified Google identity, profile authorization, and Junyu-only gate must protect all portal access. Protected deployment URLs can use a private Preview share link so testing does not require a Vercel account. No placeholder OAuth credentials are acceptable.

No production Auth settings, profiles, roles, invitation/reset proofs, credentials, mail delivery, or deployment were changed by this beta setup. Compare production against the deployment observed at the start of each continuation; another release may have occurred since the previous preparation report.

Local verification uses isolated staging, the new beta backend, and Preview policy. The optimized clean Node 24 build and TypeScript check passed, together with 142 focused tests across nine files and changed-file lint/format checks. On `http://127.0.0.1:3201`, actual browser interactions rejected an unlisted school email at Google initiation, and direct recovery navigation explained email-disabled Google recovery without a send form. Expired-link help used Google recovery and retained the same-browser resume choice. Password fallback and Junyu's support link remained visible, with no framework overlay or relevant console error. Password-form Google recovery and Admin email guards have unit/component coverage but await authenticated browser checks. These are local checks, not a hosted application Preview receipt, inbox delivery, successful Google consent, or a six-character password save by Junyu. The real-person acceptance list below remains open.

### Short school IT request

> Hi IT — The isolated NHS Hours beta backend and single tester account (`junyuc2027@sks.org`) are prepared. Could you create/provide an approved Google OAuth Web client using only `openid`, email, and profile, allow it for this SKS account (including student/under-18 controls), and provide SMTP credentials for an approved school sender? Google's exact redirect URI is `https://xapmsimnbsrojaknpkbn.supabase.co/auth/v1/callback`; the portal origin is `https://sks-nhs-hours-login-beta.vercel.app`. No Gmail or Drive access is needed. I'll finish the provider, email templates, and protected Preview deployment. Current members and production stay unchanged; school ownership and successor access will be arranged before rollout.

## School setup still needed

1. **School ownership and handoff.** The personal-account beta backend and Vercel project above are prepared, including all migrations through `20261011010000_verified_account_setup.sql`. Do not reapply them or include the development seed. Keep production data and Auth users out of beta; use invented service records. Before long-term rollout, arrange school-owned infrastructure and successor access without adding the maintainer to organizations in a way that exceeds their Free-project allowance. Record exact source/destination project references before any migration or ownership change.
2. **School Google OAuth.** An SKS Google Workspace/Cloud administrator creates a school-owned Web OAuth client and school-internal consent configuration. Request only `openid`, email, and profile. Add the beta Supabase provider callback URI shown in its Google provider page, then store its client ID/secret in that beta project. Add the exact beta application callback to Supabase's redirect allowlist. School API access controls must allow this client for the volunteer cohort, including any applicable student/under-18 restrictions. The app requests account selection so a personal Gmail session is not silently chosen.
3. **Verify the prepared beta account.** Keep public signup disabled and the tester list restricted to Junyu. Junyu's Auth identity, active profile, first beta owner/Admin grant, and active `2026-2027` year are already prepared through the service-role bootstrap RPC. Do not recreate the identity, assume its email is verified, or choose a preset password. Verify real Google ownership, the unchanged Auth/profile ID, Admin access, and the optional six-character fallback. Never assign a production membership/role as part of beta setup. For subsequent roster invitations, the configured Google workflow prepares an unconfirmed Auth identity only after the database authorizes the invitation; Google still proves email ownership. Optional password email failure does not block Google access or fabricate a send receipt. One Admin tester can test staff access and password fallback; add an approved ordinary-member/teacher volunteer before signing off the full student onboarding/review experience.
4. **School-owned mail delivery.** Configure custom SMTP with an approved From address/name, school-managed credentials, SPF/DKIM as required by the sender, delivery/bounce handling, and enough capacity for the onboarding roster. Target at least 100 messages/hour, within the provider's actual limits. Disable email link tracking that rewrites Auth URLs. Supabase's default sender and two-email/hour quota are not sufficient for school onboarding.
5. **Hosted beta Auth settings.** Match the policy below and apply both reviewed email templates. Use the Supabase Management API setting `mailer_otp_exp: 172800` for 48 hours if the dashboard limits expiry to 24 hours; do not push the local development URLs to a hosted project. Run the read-only preflight, then verify actual mail and Google sign-in with Junyu. Configuration success is not an inbox receipt or human test.

Official setup references: [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [Google Workspace app access controls](https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data).

## Hosted policy and preflight

| Hosted setting                                    | Beta/release target                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Password minimum/types                            | 6 characters / no required types                                                                        |
| Public signup / anonymous accounts                | Disabled / disabled                                                                                     |
| Email ownership confirmation                      | Required                                                                                                |
| Google provider                                   | Enabled in beta only during the pilot                                                                   |
| Additional password-change email reauthentication | Disabled; the portal still requires its signed verified-link context                                    |
| Email OTP expiry                                  | `172800` seconds: 48 hours for invitation/reset proofs                                                  |
| Invitation roster deadline                        | Seven days; independent of email proof expiry                                                           |
| Verified password form                            | 48 hours after verification, bound to user and browser, resumable without renewing expiry               |
| Email templates                                   | `supabase/templates/invite.html` and `recovery.html`, targeting `/auth/confirm`                         |
| SMTP and email quota                              | School-owned sender; roster-sized quota                                                                 |
| Site URL / redirects                              | Exact beta origin / exact `/auth/callback`, `/auth/recovery-callback`, `/update-password`; no wildcards |

Run on Node 22.18+ or Node 24 with the **target** environment loaded:

```sh
pnpm check:auth-config
```

For the one-person Google-only pilot, use `pnpm check:auth-config --google-pilot` with `AUTH_GOOGLE_MODE=beta` and `AUTH_BETA_EMAIL_ENABLED=false`. This mode reuses the isolation/cohort checks and still requires correct Google, password, 48-hour expiry, ownership, signup, redirects, and migration settings. It skips only SMTP, mail capacity, and mail-template checks, and prints that those were not validated. It cannot be used for ordinary production/enabled mode or an email-enabled beta. Use the full command and real inbox checks before enabling beta email or school onboarding.

The command needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in addition to the application environment. Supply credentials through the local secret store or an approved secret manager; do not paste them into commands, commits, or tickets. It reads Auth settings and performs a read-only SQL check for the setup migration. A failed check prints setup requirements without tokens or SMTP secrets. It does not mutate hosted settings, generate proofs, resend email, or invalidate existing links.

## Fixes covered by this candidate

| Reported friction                          | Source correction                                                                     | Required evidence                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Separate portal password dependency        | Google-first sign-in, school identity and roster checks, six-character fallback       | Real school Google consent and sign-in in isolated beta |
| Erased sign-in/reset input                 | Controlled email/password fields and Show/Hide password                               | Failed-form browser interactions                        |
| Generic wrong-password/outage/link errors  | Distinct credential, unverified email, quota, service, and access messages            | Unit tests plus actual rendered errors                  |
| Consumed proof followed by database outage | Secure context before roster lookup; retry access on password page/action             | Route/action failure-retry checks                       |
| Resend blocked by empty password           | Authorize context first; resend independent of password validation                    | Empty-password resend test                              |
| Reload hides code challenge                | HTTP-only marker bound to original setup nonce/expiry                                 | Reload compatibility browser test                       |
| Day-two email dependency                   | Disable hosted challenge in beta; retain tested compatibility for old environments    | Hosted preflight plus real later form test              |
| Password success logs user out             | Clear only setup cookies; preserve sign-in and enter dashboard                        | Actual local Auth save → portal entry                   |
| False “Password set” badge                 | Durable verified password change/sign-in evidence; separate email/Google/visit states | Database regression including temporary invite password |
| Next-year login/access loop                | Password sign-in claims authorized pending invitation; future/draft-year messaging    | Claim tests and returning-member rollover rehearsal     |
| Expiration wording mismatch                | Separate roster deadline, 48-hour email proof, and 48-hour form                       | Hosted settings and rendered email templates            |
| No working support/handoff                 | Configurable help mailbox; beta temporary contact; school ownership procedure         | Clickable support UI and successor-admin rehearsal      |

Older passwords are **not confirmed**, rather than assumed absent. Historical hashes/portal visits are not backfilled as proof. A later password login or verified password change establishes the milestone. If tracking fails, it must not prevent valid sign-in.

## Real-person beta acceptance

Record date, beta URL/project, commit SHA, tester, browser/device, expected result, actual result, and any issue. Do not store passwords, email proofs, or OAuth tokens in the log.

- Junyu opens only the beta URL, sees the closed-beta banner, chooses the school Google identity, and reaches the beta Admin area.
- A different school account and a personal Gmail account are rejected without receiving portal access. Cancelling Google returns to a clear password fallback.
- A pre-provisioned beta member with an unaccepted invitation can enter through Google without choosing a portal password. Confirm the same Auth/profile ID is used when a password is later configured. Supabase automatic linking can remove unconfirmed identities; test this in beta before exposing Google to pending production invitees.
- From My profile, a Google user can select Set or change portal password, verify through school Google again, and choose a six-character fallback without a reset email. Setting a fallback is optional.
- A beta password user can sign in with a six-character password. Incorrect credentials remain in the form for correction, and Show/Hide works on phone and desktop.
- Real invitation and recovery emails reach SKS inboxes. Normal email prefetch does not verify the proof; Continue does. Confirm delivery through the provider and inbox rather than treating a successful API call as delivery.
- An expired/replaced/used proof produces the correct help choices. A still-valid browser form can be resumed, corrected, and saved without reopening the proof. The later form does not require an extra email when the target hosted policy is applied.
- Saving a password enters the portal without another login. Sign-out on one device does not sign out another device.
- A future/draft-year member sees that access is not open yet. Activate the beta year and confirm the returning account works with the same credentials and profile.
- A successor Admin can resolve a synthetic account problem and identify the infrastructure/mail owners without help from the graduating maintainer.
- The current production origin still uses its existing release, and no production Auth setting, profile, invitation, recovery proof, or signing secret was changed.

## Rollout and rollback

Do not merge/promote this candidate to production until the real-person checks are complete, the school setup is verified, and the owner approves the results. Record approval before setting `AUTH_GOOGLE_BETA_APPROVED=true` and using `AUTH_GOOGLE_MODE=enabled` in production. Keep password fallback visible.

Apply the additive setup-tracking migration before the application release. Update SMTP/templates/expiry as a coordinated, reviewed hosted configuration change; source commits alone do not apply them. Preserve the existing canonical production URL and password-context signing secret. Do not rotate secrets, recreate Auth users, bulk resend, or regenerate links during rollout. Existing unconsumed links retain their format compatibility; previously consumed/expired proofs cannot be revived by an app deployment and require fresh recovery proof.

Rollback the app to the recorded prior release or set Google mode to `disabled` and redeploy. Do not drop the additive milestone data, remove linked identities, or delete beta/production users as an app rollback. Retain six-character password fallback and verified email ownership throughout.
