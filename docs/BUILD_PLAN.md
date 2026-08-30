# NHS Service Hours Portal — Build Plan

## Baseline

- The repository began as an application-empty Git repository containing only Supabase CLI configuration.
- The existing uncommitted root `.gitignore` changes are user-owned and must be preserved.
- The target stack is Next.js App Router, strict TypeScript, React, Tailwind CSS, shadcn/ui, Supabase Auth/PostgreSQL/RLS, Zod, Vitest, Playwright, GitHub Actions, and Vercel.

## Delivery sequence

1. Inspect repository state, required skills, current supported package versions, and the three requested open-source references. Record license-safe architectural ideas only.
2. Generate coordinated desktop and mobile product concepts, extract a design system, and lock the primary information architecture before coding.
3. Scaffold a production Next.js application and establish server-only Supabase clients, authentication/session middleware, centralized authorization, validation, security headers, and error handling.
4. Add reproducible Supabase migrations for profiles, school years, memberships, roles, categories, requests, immutable reviews, invitations, audit events, correction records, views, transactional RPCs, indexes, grants, and deny-by-default RLS.
5. Implement the shared login and expired-account experience; member dashboard, history, draft/submission/edit/withdraw/resubmit flows; leader queues, roster, profiles, reviews, and reassignment; and global-admin accounts, annual access, fixed targets, category availability, school-year transition, role preview, audit, exports, CSV import, and correction workflows.
6. Add deterministic development seed data and tests for calculations, validation, role/date logic, CSV safety, database constraints, RLS allow/deny cases, concurrency, audits, and complete browser workflows.
7. Complete README, architecture, database, security, administration, school-year transition, deployment, testing, attribution, and operational documentation.
8. Run formatting, lint, typecheck, unit/integration/database/RLS/E2E tests, production build, dependency/security scans, and desktop/mobile browser QA; fix failures and compare rendered screens against the generated design concepts.
9. Attempt a Vercel preview deployment and verify only the external steps permitted by available credentials. Clearly distinguish deployed, deploy-ready, and manually required work.

## Completion gates

- No mock-only workflow, unimplemented control, or required TODO remains.
- Server authorization and database RLS both cover protected reads and mutations.
- Concurrent review attempts produce exactly one valid decision.
- Approved records, review history, correction history, and audit events are traceable and archive-safe.
- All required checks pass, required viewports are inspected, and external configuration gaps are documented precisely.
