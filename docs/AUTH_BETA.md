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
| `GOOGLE_AUTH_ALLOWED_DOMAINS`        | Enforced on the verified Google email at the callback. Google's `hd` parameter is only a hint.                                                                                           |
| `AUTH_GOOGLE_MODE=enabled`           | Requires `AUTH_GOOGLE_BETA_APPROVED=true`, set only after recorded real-person beta approval. Roster/profile checks continue.                                                            |
| `NHS_SUPPORT_EMAIL`                  | Renders a working support mail link. If omitted, the UI refers to the NHS adviser without inventing a mailbox.                                                                           |

Use `.env.beta.example` as the preview template. All beta secrets and keys must be new and restricted to the beta project. A beta configuration using the production Supabase URL fails closed. Never enable `NHS_DESIGN_PREVIEW` on a remote deployment.

## Hosted preparation status — October 12, 2026

A separate Vercel project, **sks-nhs-hours-login-beta**, has been created. Its verified, reserved origin is `https://sks-nhs-hours-login-beta.vercel.app`. Vercel Authentication is configured with Standard Protection, the runtime is Node 24, and the ten prepared environment variables apply only to Preview. They include Junyu's server-side tester allowlist and temporary support contact, a new password-context signing secret, and the public production Supabase origin used solely as an isolation guard. No Git auto-deploy connection or Production environment variables were added to this project.

**The beta is not deployed or ready for login yet.** Supabase rejected creation of the separate database because the current account already owns/administers its two active Free projects. No existing project was paused, deleted, upgraded, or reused. School IT needs to provide a separate beta Supabase project, or an explicitly approved paid-project arrangement is needed. The prepared Vercel project has no Supabase credentials and therefore cannot use production Auth or student data. Junyu's beta Auth account/Admin access cannot be provisioned until that backend exists.

The ignored `.beta-setup/` directory contains the private resource record and a staging copy of committed source with a beta-only Vercel project link. Keep deployment operations in that staging directory; the repository root still has its existing production project link. Do not deploy an incomplete application, add placeholder Supabase credentials, or use the reserved origin as a test link before a Preview deployment is ready and the alias is verified. When the backend and school credentials are available, complete the setup below, run the read-only preflight, deploy to **Preview**, and verify the stable alias remains protected and the runtime reports `VERCEL_ENV=preview`.

The production deployment remained `dpl_AUBh6CtzEscFL395f6HwoaNGstwC` at commit `f6a3a7030ea360d27c81a88d8e29eaeef9860cd7` after hosted preparation. Its public login page remained available without the Google beta button or banner. No production Auth settings, accounts, invitation/reset proofs, or mail delivery were changed during this setup.

### Short school IT request

> Hi IT — I'm preparing an isolated NHS Hours Google sign-in beta for `junyuc2027@sks.org` only. Could you provide a school-owned Supabase beta project (my account's two free slots are already used), create and approve a school-internal Google OAuth Web client with only `openid`, email, and profile access, and provide SMTP settings for an approved school sender? The separate Vercel project is prepared. Google's redirect URI must be the new beta Supabase project's `/auth/v1/callback`; the portal's reserved origin is `https://sks-nhs-hours-login-beta.vercel.app`. I'll handle the schema, 48-hour email-link settings, templates, and beta Admin account. Current members and production will remain unchanged during testing.

## School setup still needed

1. **School-owned infrastructure.** Obtain an isolated school-owned Supabase project and use the prepared Vercel beta project described above. Apply the repository migrations to the beta only, including `20261011010000_verified_account_setup.sql`; do not include the development seed. Keep production data and Auth users out of beta; use invented service records. Record the exact beta project reference and production reference before running any migration. Keep the school as the infrastructure owner and arrange the maintainer's access without exceeding their Free-project allowance.
2. **School Google OAuth.** An SKS Google Workspace/Cloud administrator creates a school-owned Web OAuth client and school-internal consent configuration. Request only `openid`, email, and profile. Add the beta Supabase provider callback URI shown in its Google provider page, then store its client ID/secret in that beta project. Add the exact beta application callback to Supabase's redirect allowlist. School API access controls must allow this client for the volunteer cohort, including any applicable student/under-18 restrictions. The app requests account selection so a personal Gmail session is not silently chosen.
3. **Provision the beta accounts.** Keep public signup disabled. Create the approved tester's beta Auth account and active profile, then assign **Admin** through the protected Accounts workflow using the beta owner. Follow the existing bootstrap RPC procedure for a separate first beta owner if the project is empty. Bootstrap and assign Junyu before enabling the closed-beta gate, using a protected preview with Google mode disabled; then restrict the enabled beta to Junyu. A maintainer can be temporarily allowlisted for an authorized maintenance session, then removed from the tester list. Never assign a production membership/role as part of beta setup. For subsequent roster invitations, the configured Google workflow prepares an unconfirmed Auth identity only after the database authorizes the invitation; Google still proves email ownership. Optional password email failure does not block Google access or fabricate a send receipt. One Admin tester can test staff access and password fallback; add an approved ordinary-member/teacher volunteer before signing off the full student onboarding/review experience.
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
