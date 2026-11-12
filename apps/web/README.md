# RecallFarm web

Public site (`/`), certificate check (`/verifier`), organisation admin console (`/admin/*`) and the
parametrisation studio (`/admin/studio/*`). React 18, Vite 5, TypeScript strict, react-router 6,
TanStack Query 5, plain CSS (no UI kit, no chart library), PWA for the admin.

Contract: `docs/MVP-SCOPE.md` §4–§5. Designs reproduced: `docs/design/{Main,Admin,Studio}.dc.html`.

## Quick start

```bash
cd apps/web
npm ci
npm run dev:mock       # http://localhost:5173 — every screen works without the API (fixtures)
npm run dev            # same, but /v1 is proxied to the API (VITE_API_PROXY, default http://localhost:3000)
```

Demo accounts (mock mode, and the API seed): the OTP code is shown on the login screen (`dev_code`).

| Phone | Who | What to look at |
|---|---|---|
| +237 6 90 00 00 02 | Aïcha Nana, admin of « Coop. avicole du Centre » | dashboard, farms, reminders, alerts, subscription, imports, users |
| +237 6 90 00 00 03 | Jean-Marc, `param_author` | studio: edit the `filiere.porcin` 2.0.0 draft, request review, try to publish (four-eyes error) |
| +237 6 90 00 00 04 | Dr Mbarga, reviewer and publisher | studio: approve, then publish 10 / 50 / 100 % |

Mock mode tips: the mobile-money simulator confirms after ~6 s; a number ending in `99` is refused,
one ending in `98` never answers (shows the 2-minute timeout). `/verifier` has a sample certificate button.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` / `dev:mock` | Vite dev server (API proxy / fixtures) |
| `npm run build` | `tsc -b` (strict, zero errors) then production build to `dist/` (fixtures excluded) |
| `npm run build:mock` | production build with fixtures to `dist-mock/` (demos, screenshots) |
| `npm run preview` / `preview:mock` | serve `dist/` / `dist-mock/` on :4173 |
| `npm test` | Vitest (non-interactive): expression vectors, API client, form renderer, pages |
| `npm run lint` | ESLint (typescript-eslint, react-hooks, jsx-a11y), zero warnings |
| `node scripts/screenshots.cjs <out> [designOut]` | Playwright screenshots of the mock preview (and of the design files) |
| `node scripts/gen-assets.cjs` | regenerates PNG icons and `og-image.png` from the logo |

## Environment variables (build time)

| Variable | Default | Role |
|---|---|---|
| `VITE_MOCK` | `0` | `1` = answer every `/v1` call from in-browser fixtures (`src/mocks`, loaded by dynamic import only in this mode) |
| `VITE_API_PROXY` | `http://localhost:3000` | dev only: target of the Vite proxy for `/v1` |
| `VITE_PUBLIC_URL` | `https://recallfarm.app` | canonical and Open Graph URLs in `index.html` |

The app always calls the API with relative URLs (`/v1/...`): same origin behind the gateway.

## Docker

```bash
docker build -f apps/web/Dockerfile -t recallfarm/web .   # context = repo root
```

Multi-stage: `node:22-alpine` build → `nginxinc/nginx-unprivileged:1.27-alpine` (uid 101, port 8080).
`nginx.conf`: SPA fallback, gzip, one-year cache for hashed `/assets/`, no-cache for `index.html` and
`sw.js`, CSP and security headers, `/healthz`, `/v1/` answers 404 (the gateway proxies it to the API).

## Structure

```
src/
  api/          types.ts (contract), client.ts (errors, 401 → refresh → retry once), session.ts, endpoints.ts
  admin/        auth (OTP session, guard), Shell (gradient header + tile sidebar), pages/*
  studio/       StudioShell, Catalogue (S01), Workspace (S02/S03/S04/S07: protocol editor, frise, diff,
                validation circuit, test vectors, mobile form preview)
  pages/public/ Home (Main.dc.html), Verify (/verifier), NotFound
  components/   charts.tsx (SVG line chart, hex coverage map, frise, sparkline, gauge), FormRenderer.tsx,
                ui.tsx (skeletons, empty/error states, dialog, toasts), icons, logo
  lib/          expr.ts (CEL subset, packages/params/EXPRESSIONS.md), format.ts (fr-FR), plans.ts
  mocks/        dev/test fixtures (design data) and a mock transport mirroring the API contract
  styles/       tokens.css (every design token), base, site, admin, studio
```

Accessibility: skip links, visible focus, labelled controls, focus-trapped dialogs (Esc closes),
keyboard menus, `aria-live` for async results, `prefers-reduced-motion`, data tables behind the charts.

## Verified against the real API (apps/api)

The production build was walked through with Playwright behind a gateway serving `dist/` and proxying `/v1`
(dashboard, farms, farm detail, reminders confirm/snooze, alerts, surveillance, checkout, CSV import/export,
invitations, studio as author/reviewer, `/verifier` with a real signed payload, pricing from `/plans`).
Adaptations made for the real shapes: reminder `timing` (engine status) shown instead of the stored `status`;
farm `locality`; `/alerts?organisation_id=`; `/studio/versions/:id/test` returns `passed` as a boolean;
simulation offsets read from `events[].notifications`; inherited labels fetched with
`/params/packs/:code/versions/:version`; axial hex coordinates of the coverage map laid out as a honeycomb.

## Payments (P1.1 / P1.2)

- **Money**: integer in the ISO 4217 minor unit + the currency received from the API, formatted by
  `money(amountMinor, currency)` (`Intl.NumberFormat`, exponent and label from the platform). No default
  currency, no hard-coded « FCFA »; `src/lib/no-hardcoded-currency.test.ts` fails when one appears in `src/`
  (mocks and tests excluded). Prices come from `GET /plans` only (no fallback amounts).
- **Checkout** (`Subscriptions.tsx`): sends `id` = client-made UUID v4 (`newPaymentId`). The same id is kept for any retry
  of the same payment (network error, double tap); a new id is taken after an explicit refusal (`PAY-INIT`, the server
  would replay the same refusal) or when phone/method change (`409 PAY-IDEMPOTENCY`).
  `PAY-PENDING` never re-sends: « Paiement en cours de vérification », the payment is polled. Statuses handled:
  `initie, en_attente, a_verifier, confirme, echoue, remboursement_en_cours, rembourse` (`lib/payment.ts`).
- **Administration** (`/admin/paiements`, `pages/Payments.tsx`): list filtered by status, detail with history, « Interroger »
  (`ops`), « Rembourser » with a reason (`platform_admin` only), daily reconciliation reports and manual run
  (`platform_admin`). Rights mirror `admin-payments.controller.ts` (`paymentRights`). Texts: `lib/i18n-payments.ts` (fr + en keys).
- **Tests**: vitest + testing-library for every screen and state (loading, empty, error, forbidden); axe-core on each screen
  (`src/test/a11y.ts`, ADR-005); Playwright `e2e/admin-paiements.spec.ts` against the mock build
  (`SHOT_DIR=<dir>` saves screenshots).

## API assumptions beyond MVP-SCOPE.md

Typed in `src/api/types.ts` (marked ASSUMPTION) and mirrored by `src/mocks/server.ts`:

- `GET /organisations/:id` → `{ plan, farmers_count }` for the sidebar card.
- Dashboard: `confirmed_rate` / `target_rate` / `avg_mortality_pct` in percent (ratios 0..1 also accepted);
  optional `kpis.mortality_threshold_pct`, `coverage.window_days`, `coverage.cells[].q,r,farms` (hex position),
  `todo[].farm_id`, `todo[].severity ∈ critique|elevee|info`, `pending_change: {summary, reviewer_name}`.
- `GET /organisations/:id/farms` items add `owner_name, owner_phone, has_smartphone, last_sync_at,
  open_reminders, overdue_reminders, open_alerts`.
- `GET /organisations/:id/reminders` and `/reminders`: `status` accepts a comma list; items carry
  `farm_name, subject_ref, label`; statuses include engine-derived `en_retard`, `aujourdhui`, `a_venir`.
- `GET /alerts` without `farm_id` is scoped to the caller's organisation; items carry `farm_name, title, message`.
- `GET /farms/:id/kpis` → `{ period, kpis:[{code,label,value,unit,status:'ok'|'amber'|'red',subject_name}], margin:{month,revenue,expenses,margin} }`.
- `GET /farms/:id/daily-logs` items carry `subject_name`; `?limit=` honoured.
- `GET /plans` → `{data:[{code,name,rank,features,quotas,price:{monthly:Money|null,yearly:Money|null,from?}|null}]}`
  (flat `monthly_minor`/`yearly_minor` also accepted; `price: null` = « sur devis »).
- `GET /payments/:id` statuses: `initie | en_attente | confirme | echoue | rembourse` (enum of dossier 03).
- `GET /subscriptions/current` → `{plan, period, status, started_at, expires_at, grace_until, account_type}`.
- `POST /imports` multipart (`file`, `kind=farmers`, `organisation_id`) → adds `preview` (parsed rows) and
  `total_rows`; error `row` numbers are file line numbers (header = 1). `POST /imports/:id/commit` → `{created, updated, skipped}`.
- `POST /exports {kind, scope, period: '7d'|'30d'|'90d'|'365d', organisation_id}` → `text/csv` with `Content-Disposition`.
- Members: `{id, user_id, name, phone, role, status, joined_at, last_seen_at}`; `POST` accepts `name`.
- `GET /certificates/verify` may add `reason` when `valid: false`; malformed payload → 422 `VALIDATION_ERROR`.
- Studio: `GET /studio/versions/:id` (not listed in MVP-SCOPE) returns the version **with** `content`,
  `author_id, author_name, reviews[], rollout_pct, assigned_reviewer_name?`; `GET /studio/packs` rows
  `{code, level, title, published_version, draft:{id,version,status}|null, requires, adoption_farms, updated_at}`;
  diff `{base_version, changes:[{op:add|remove|change, path, before?, after?}], major, impact:{subjects_recomputed}}`;
  simulation `{events:[{step,label,offset_days,due_date,kind:vaccin|soin|jalon,conditional,after_step}], reminder_offsets, withdrawal_applied}`;
  test run `{passed, total, results:[{name, ok, message?}]}`; validate errors use paths `objects[i].steps[j].field`.
  Four-eyes violations (review or publish by the author) → 422 `BUSINESS_RULE` with `details.rule = "RG-PAR-04"`;
  version statuses `brouillon → en_revue → teste (approved) → publie`.
- Protocol steps may carry `label, short_label, type: vaccin|soin, condition (CEL), after_step` and
  `override.offset_days {policy:'bornee', min, max}` (country bounds); protocols may carry `title, validator, end:{label, offset_days}, withdrawal_meat`.
