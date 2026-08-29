# NHS Service Hours Portal — Design System

## Accepted concept references

- `docs/design/member-dashboard-desktop-v2.png` — 1487 × 1058 member dashboard.
- `docs/design/admin-dashboard-desktop-v2.png` — 1487 × 1058 teacher-admin overview.
- `docs/design/review-request-desktop.png` — 1487 × 1058 focused review screen.
- `docs/design/log-hours-mobile.png` — 853 × 1844 mobile submission flow.

These images define the visual system, density, layout rhythm, and primary interaction anatomy. Required product behavior and the repository specification remain authoritative when sample concept data differs from policy or seeded data.

## Visual direction

The portal is a quiet, table-led school-administration product. It uses true-white primary surfaces, a cool-slate navigation rail, deep forest green for primary actions and approved progress, ink navy for hierarchy, restrained amber for pending/attention states, and red only for destructive or rejected states. Decoration is intentionally sparse.

No marketing hero, decorative eyebrow, glass effect, gradient wash, illustration, stock image, or default bento-card layout is part of the accepted direction.

## Tokens

| Token              | Value     | Use                                                |
| ------------------ | --------- | -------------------------------------------------- |
| `background`       | `#ffffff` | Page and table surfaces                            |
| `foreground`       | `#0b1736` | Primary ink/navy text                              |
| `primary`          | `#075b3a` | Primary actions, selected state, approved progress |
| `primary-hover`    | `#04482e` | Hover/pressed primary action                       |
| `primary-soft`     | `#e8f1ed` | Selected navigation and subtle approved state      |
| `muted`            | `#f4f7f8` | Navigation rail and quiet grouped surfaces         |
| `muted-foreground` | `#526071` | Helper, secondary, and metadata text               |
| `border`           | `#d8dee4` | Dividers, controls, and table rules                |
| `pending`          | `#c97400` | Pending and changes-requested emphasis             |
| `pending-soft`     | `#fff7e8` | Pending/attention background                       |
| `destructive`      | `#b42323` | AA-safe rejection and irreversible action emphasis |
| `info`             | `#2563eb` | Keyboard focus and informational notices           |

- Radius: 8px controls, 10–12px grouped surfaces, round avatars/icons only where semantically expected.
- Shadow: essentially flat; one faint shadow is permitted on a primary progress band or sticky action surface.
- Border: 1px cool gray; selected navigation additionally uses a 3px green left rail.
- Focus: visible 2px blue outline with offset; never remove browser focus without replacement.

## Typography

- Family: a system humanist sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Inter`, sans-serif).
- Desktop page title: 34–40px, weight 650–700, tight but readable line height.
- Mobile page title: 32–36px.
- Section title: 20–24px, weight 650–700.
- Body: 15–17px desktop, 16–18px mobile, line height 1.45–1.6.
- Control and table text: deliberately 14–16px; never browser-default, tiny, or low contrast.
- Numeric progress statements may scale to 44–54px on desktop but must retain a text equivalent.

## Layout and container model

### Desktop

- Quiet 80–88px top bar.
- Fixed 280–304px left navigation rail.
- Main content uses a 32–48px gutter and a wide open canvas.
- Tables and definition lists are preferred over repeated cards.
- The member dashboard uses one progress band, an attention row, and a history table.
- The admin overview uses one metric rail, one request queue table, one roster table, and one attention row.
- The review page uses a broad activity/history column and a narrower member-context/decision column.

### Mobile

- No desktop side rail.
- Compact top bar, single-column form/content flow, sticky or near-sticky bottom actions, and three-item bottom navigation.
- Controls have at least 44px tap targets.
- Desktop tables become labeled record cards or horizontally scrollable tables only when every column remains understandable.
- Actions stack in decision priority order; destructive controls remain visually separated.

## Component families

- `AppShell`: top bar, role-aware desktop sidebar, mobile header, bottom navigation.
- `PageHeader`: breadcrumb/back navigation, title, primary action.
- `ProgressSummary`: approved-only bar, true percentage text, pending value, remaining/over-goal value.
- `MetricRail`: open divided statistics, not six floating cards.
- `StatusBadge`: icon plus visible text; status is never conveyed by color alone.
- `DataTable` and `MobileRecordList`: sorting, filtering, row affordance, empty/loading/error states.
- `AttentionRow` / `Alert`: changes requested, expiring membership, safe informational notices.
- `FieldGroup` / `Field`: label, control, description, validation message, disabled/pending state.
- `DefinitionList`: request facts, member facts, school-year facts.
- `ReviewTimeline`: immutable actor/action/timestamp/comment events.
- `DecisionPanel`: comment field, approve, request changes, reject, and reassign actions.
- `Empty`, `Skeleton`, `Spinner`, `Dialog`, `Sheet`, and `Toast` use shadcn composition rules.

## Icon inventory

Use the configured outline icon family consistently, approximately 1.75px stroke:

- Navigation: home, pencil/log, users, account badge, shield/audit, download/export, settings.
- Status: check-circle approved/active, clock pending, alert-circle changes requested, x-circle rejected, archive/withdrawn.
- Controls: plus, chevron, arrow-left, search, filter, sort arrows, calendar, lock.
- Categories may use restrained semantic icons only when they improve scanning; category text remains primary.

Icons inside controls inherit control sizing. Avoid arbitrary icon-size overrides and text glyph substitutes for directional controls.

## Visible-copy lock for primary viewports

Required primary labels include:

- Brand: `NHS Service Hours`.
- Member navigation: `Dashboard`, `Log Hours`, `My Profile`.
- Admin navigation: `Admin overview`, `Review requests`, `Members`, `Accounts`, `Audit trail`, `Exports`, `Settings`.
- Member heading: `Your service progress`; action: `Log Hours`.
- Admin heading: `NHS overview`; action: `Review requests`.
- Review heading: `Review request`; action: `Back to queue`.
- Form heading: `Log service hours`; actions: `Submit request`, `Save draft`.

Additional labels required by real workflows may be introduced when the product specification mandates them; decorative copy is not allowed.

## Accessibility and interaction

- Semantic landmarks and headings; one clear page `h1`.
- Every field has an associated label, description, and error region where applicable.
- Progress bars expose `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and a full text description.
- Badges use icon + text; charts or color-only legends are not used.
- Keyboard focus is visible on every interactive element.
- Dialogs, sheets, and drawers have accessible titles.
- Motion is limited to useful state transitions and respects `prefers-reduced-motion`.

## Concept-to-code verification points

At final QA, compare at least:

1. Top bar/sidebar proportions and open-canvas gutters.
2. True-white background, forest-green primary, ink text, amber pending, and cool-gray rules.
3. Heading/control typography and readable table density.
4. Approved-only progress fill with pending and true percentage separate.
5. Table-first container model without nested card grids.
6. Review decision hierarchy and comment-field focus treatment.
7. Mobile field spacing, action stacking, and bottom navigation.
8. Status icon/text pairing and visible focus behavior.
