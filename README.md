# NHS Service Hours Portal

A private, school-year-based portal for National Honor Society members to submit service hours and for authorized student leaders and teacher administrators to review, report, and audit them.

The application separates authentication from authorization: signing in is not enough. Access requires a provisioned active profile, an eligible school-year membership, and the role needed for the action. PostgreSQL constraints, grants, Row Level Security, and transactional functions are the final data-integrity boundary.

## Capabilities

- Invite-only email/password access through server-verified invite/recovery token hashes, a 30-minute user-bound password-update context, and optional school Google OAuth
- Annual memberships with `member`, `committee_head`, `president`, `vice_president`, and `teacher_admin` roles
- Draft, submit, withdraw, changes-requested, resubmit, approve, reject, and reassign workflow
- Self-review prevention, concurrent-decision protection, immutable review history, and traceable corrections
- Exact quarter-hour calculations with approved, pending, remaining, and over-goal progress
- Leader queues and roster/member history; teacher-admin account, school-year, category, target, audit, and CSV workflows
- Responsive, keyboard-accessible interface with textual status/progress equivalents

## Stack

- Next.js App Router, React, strict TypeScript, Tailwind CSS, and shadcn-style components
- Supabase Auth, PostgreSQL, Row Level Security, and migration-defined RPCs
- Zod for runtime input validation
- Vitest, pgTAP/Supabase database tests, Playwright, and axe
- pnpm and Vercel

## Local development

Prerequisites: Node.js 22 recommended (Next.js minimum 20.9), pnpm 11.19.0 through Corepack, Docker, and Supabase CLI 2.x.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase status
```

Put the local Supabase URL and keys from `supabase status` into `.env.local`; generate a separate `PASSWORD_UPDATE_CONTEXT_SECRET` with at least 32 random bytes (for example, `openssl rand -hex 32`). Never paste either output into logs or documentation. Then recreate the local database and run the app:

```bash
supabase db reset --local
supabase test db
pnpm test:e2e:prepare
pnpm dev
```

Open `http://localhost:3000`. Supabase Studio is available at `http://127.0.0.1:54323`, and locally captured email at `http://127.0.0.1:54324`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
supabase test db
pnpm build
pnpm test:e2e:prepare
pnpm test:e2e
pnpm audit --audit-level=high
```

`pnpm check` runs formatting, lint, typecheck, unit tests, and the production build; database and browser tests remain separate gates. Do not infer passing status from the command list—see the verification ledger in `docs/QA.md` for observed results.

## Configuration and deployment

Copy `.env.example`; never commit `.env.local` or real credentials. The elevated Supabase key is server-only and must never use a `NEXT_PUBLIC_` variable. Public signup remains disabled, and an allowed school email domain never grants membership by itself.

Use separate Supabase projects and scoped Vercel variables for Preview and Production. Apply reviewed migrations before the compatible application deployment, verify Auth redirects and RLS, and treat application rollback separately from database recovery. The exact procedures and release checklist are in `docs/OPERATIONS.md`.

## Documentation

- `docs/ARCHITECTURE.md` — components, data flows, trust boundaries, and invariants
- `docs/DATABASE.md` — database operations, schema contract, RPCs, views, grants, and migrations
- `docs/DATA_MODEL.md` — schema, relationships, constraints, functions, views, and RLS model
- `docs/SECURITY.md` — security/privacy model, findings, and release gates
- `docs/ADMIN_GUIDE.md` — account, role, request, correction, reporting, and succession procedures
- `docs/SCHOOL_YEAR_ROLLOVER.md` — annual renewal, activation, validation, and history-preservation checklist
- `docs/DEPLOYMENT.md` — exact Supabase/Auth/Vercel release, backup, domain, smoke, and rollback steps
- `docs/TESTING.md` — contributor commands, test layers, fixtures, E2E coverage, and CI
- `docs/OPERATIONS.md` — local/Supabase/Vercel setup, Auth, bootstrap, backups, release, and rollback
- `docs/QA.md` — automated matrix, manual/accessibility QA, and verification ledger
- `docs/DECISIONS.md` — material architecture and product decisions
- `docs/DESIGN_SYSTEM.md` — visual and interaction contract
- `ATTRIBUTIONS.md` — reference-repository research and reuse record

## Record-handling warning

This system handles student records. Use synthetic data locally and in automated tests, keep Preview protected and isolated from Production, avoid personal data in logs/analytics, and store downloaded CSV or backup files only in approved restricted school storage. The school data owner must approve retention, incident-response, export-storage, and recovery objectives before real records are loaded.
