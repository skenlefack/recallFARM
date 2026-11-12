# RecallFarm API (`apps/api`)

NestJS 10 · TypeScript strict · TypeORM 0.3 + PostgreSQL 16 · Redis optional · base path **`/v1`**, port **3000**.
Contract: `docs/MVP-SCOPE.md` §4 (+ dossier v2.2 `05`). OpenAPI 3.1: `GET /v1/docs` (UI), `GET /v1/openapi.json`, exported to `openapi.json`.

## Run locally

```bash
cp .env.example .env            # optional: every variable has a dev default
npm ci
npm run migration:run           # DATABASE_URL (default postgres://recallfarm:recallfarm@localhost:5432/recallfarm)
npm run seed                    # idempotent demo data (can be re-run)
npm run start:dev               # or: npm run build && npm run start
npm run simulate:iot            # optional: live sensor readings (--once, --heatwave)
```

Demo accounts (OTP; with `OTP_DEV_ECHO=true` the code is returned as `dev_code`, all SMS are visible at `GET /v1/dev/outbox`):
`+237690000001` Marthe (Pro, « Ferme de Mfou »), `+237690000002` Aïcha (admin « Coop. avicole du Centre », 312 farms),
`+237690000003` Jean-Marc (`param_author`), `+237690000004` Dr Mbarga (`param_reviewer`, `param_publisher`), `+237690000009` `platform_admin`,
`+237690000005` Paul M. (agent). Demo device keys: `rf-demo-<slug>` (see `src/seed/demo.ts`).

## Scripts

| Script | Purpose |
|---|---|
| `build` / `start` / `start:dev` | compile to `dist/` (incl. `dist/scripts/{migrate,seed,simulate-iot}.js`) / run / watch |
| `test` | unit tests: expression, resolution and reminder engines against `packages/params/vectors/*` (all cases), forms, Wright |
| `test:e2e` | Supertest pilot journey on `TEST_DATABASE_URL` (schema reset + migrations + seed — **destructive**) |
| `migration:run` / `migration:revert` | TypeORM migrations (hand-written, `synchronize` is off) |
| `seed` | demo seed (packs signed, accounts, Marthe's farm, coop with 12 weeks of history) |
| `simulate:iot` | posts telemetry for the demo farm (`API_URL`, `INTERVAL_S`) |
| `openapi` | writes `openapi.json` without a database (deterministic) |
| `lint` | ESLint |

Docker: `docker build -f apps/api/Dockerfile .` from the repo root. Entrypoint: migrations → seed if `SEED_ON_START=true` → `node dist/main.js`;
non-root user, healthcheck `wget /v1/health`, volumes `/app/keys` (Ed25519 key pair, generated on first start) and `/app/var` (exports).

## Environment

See `.env.example` (every variable documented). Required in production: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PAYMENT_WEBHOOK_SECRET`.
`REDIS_URL` empty → in-memory locks / OTP rate limit (fine for one instance). `PACKS_DIR` points to `packages/params/packs`.

## Module map (`src/`)

| Folder | Content |
|---|---|
| `params/expr` | hand-written tokenizer + recursive-descent parser + evaluator of the CEL subset (EXPRESSIONS.md), 10 000-op budget |
| `params/engine` | pack resolution with policies/provenance (ENGINES §1), reminder engine + notification plan (§2), form engine |
| `params` | pack storage/signature (Ed25519 over the sha256 of canonical JSON), stack per farm (rollout), `/params/*` |
| `studio` | drafts, validation (schema, expressions, policies), tests (vectors + timeline), four-eyes review/publish (RG-PAR-04), rollback, diff, simulation |
| `users` | OTP auth (3/15 min/number), JWT access/refresh, `/me`, consents, export, deletion request |
| `organisations` | members, Structure dashboard (k-anonymity < 5 farms), org farms / reminders |
| `farms`, `livestock`, `journal` | farms + settings (RG-PAR-01), batches/dogs/animals (form-validated `attributes`), daily logs (409 + alert rules) |
| `health` | health events, reminders materialisation, confirm/snooze/cancel, tasks, certificates (PDF + signed QR), protocols |
| `stock-sales`, `inbox` | stock movements/summary, sales (RG-VEN-02), expenses, pack KPIs + month margin, home inbox |
| `alerts` | alert engine (daily logs, telemetry with `for`, cooldown, escalation 15 min), `/farms/:id/live`, `/ingest/telemetry` |
| `genealogy` | `POST /mating-checks` (Wright path method), pedigree |
| `billing` | plans from packs, checkout, payments, HMAC webhook, subscriptions, signed entitlements (JWS EdDSA) |
| `notifications` | scheduler (J-7/J-1/J/J+3, quiet hours, daily SMS cap, monthly quota), `outbound_messages`, inbound SMS/USSD, `/admin/messages` |
| `sync` | `POST /sync/push` (idempotent by `(id, client_rev)`, field-level LWW, daily-log merge), `GET /sync/pull` (global `sync_version`) |
| `imports-exports`, `misc`, `dev` | CSV import/commit, CSV exports, analytics, feature flags, leads, `/health`, `/ready`, dev helpers |

## Providers and simulators

- **SMS** `SMS_PROVIDER=simulator` stores messages (readable at `/v1/dev/outbox`); `http` posts `{from,to,text}` to `SMS_HTTP_URL`;
  `connector` uses any aggregator described in JSON (`PROVIDERS_CONFIG_FILE`, ADR-002, `infra/providers/README.md`).
- **Connectors** `src/connectors/`: declarative SMS / WhatsApp / USSD / mobile-money aggregators; callbacks on
  `/v1/connectors/:name/{sms,dlr,ussd,payment}` (`sms` and `dlr` also as GET; `dlr?channel=whatsapp`);
  `GET /v1/admin/connectors`, `POST /v1/admin/connectors/:name/test-sms`.
- **USSD sessions** (`src/connectors/ussd.ts`, `notifications/ussd-session.service.ts`): cumulative or last-input mode,
  state in Redis (`REDIS_URL`) or the `ussd_sessions` table (180 s), screens paged at 160 characters ("0. Suite").
- **Payment operations** (`billing/payment-ops.service.ts`, `payments.scheduler.ts`): status queries for pending payments
  (capped exponential backoff, then `a_verifier`), refunds (`POST /v1/admin/payments/:id/refund`, `audit_log`), daily
  reconciliation (`/v1/admin/payments/reconciliations`). Checkout is idempotent (`id` from the client or `Idempotency-Key`).
  `GET /v1/payments/:id` and `GET /v1/admin/payments/:id` return `events` (provider journal: `at`, `status`, `source`
  webhook|statut; never the raw aggregator body).
- **PAY-OPEN (EF-ABO-01)**: one open payment (`initie`, `en_attente`, `a_verifier`) per payer and plan. A checkout with another
  id or key meanwhile answers `409 CONFLICT` `details: {rule: 'PAY-OPEN', payment_id, status}` (the client follows that payment);
  the replay of the same id/key is still a replay. Enforced by the partial unique index `payments_open_payer_plan_uq`
  (migration 1761500000005), so concurrent requests give one payment. **Runbook**: the migration stops if a payer already has
  several open payments for a plan and lists them; settle them first (`POST /v1/admin/payments/:id/check`, or the aggregator's
  answer), then run the migration again. A payment stuck in `a_verifier` blocks new checkouts of that plan for its payer until
  an operator settles it (see `GET /v1/admin/payments?status=a_verifier`).
- **Currency**: always the country pack's (`pays.<CC>.json` → `currency`, or the `plan_price` currency). Without one,
  `GET /plans` (and `/subscriptions/current` for a subscription stored without currency) answer `422 PAY-CURRENCY`.
- **WhatsApp**: simulator only. **Push** = journaled (`channel=push`), delivered through `/inbox` and sync.
- **Payments** `PAYMENT_PROVIDER=simulator`: checkout returns `{payment_id, status:"initie", ussd_push:true}` and auto-confirms after
  `PAYMENT_SIM_AUTOCONFIRM_MS` (5 s) through the webhook code path; `POST /v1/dev/payments/:id/confirm|fail` for manual control.
  Simulator webhook: `X-Signature` = hex HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET` (closed when
  `PAYMENT_PROVIDER=connector`: results then arrive only on `/v1/connectors/:name/payment`).
- **IoT**: `POST /v1/ingest/telemetry` with `X-Device-Key`; rules = device config or pack `sensor_profile.default_alert`.
- `/v1/dev/*` exists only when `NODE_ENV !== 'production'`.

## Conventions worth knowing

- Lists `{data, next_cursor}`; errors `{error:{code,message,fields?,details?}}`; money `{amount_minor, currency}`; business dates `YYYY-MM-DD`
  computed in `TZ` (Africa/Douala).
- Reminder `status` is the stored status (`a_venir|envoye|confirme|manque|annule|clos`); `timing` adds the engine status
  (`en_retard|aujourdhui|a_venir`). Filters accept both, comma-separated.
- Sync pull returns raw table rows in `data` (column names of dossier 03, money as `*_minor` + `currency`); push accepts the REST shapes
  (`unit_price`, `amount`, `cost`, `unit_cost`) or the column shapes. Derived fields (`current_count`, `amount`, `rabies_*`) are ignored.
- Signatures: pack `hash` = sha256 hex of canonical JSON (sorted keys, no spaces), `signature` = Ed25519 base64url of the UTF-8 `hash`;
  certificate QR = `base64url(json) + "." + base64url(Ed25519(base64url(json)))`; `GET /v1/params/public-key` → `{public_key (raw base64), jwk, pem}`.
- `round(x, n)`: half away from zero after normalising `x·10ⁿ` to 15 significant digits (same as the Dart engine).

## Known limitations

- Single-instance caches (resolved packs: 30 s TTL); the global throttler storage is in memory even with Redis (OTP limiter uses Redis).
- Pull ordering relies on a sequence: a long concurrent transaction may commit a lower `sync_version` after a pull (rare; clients re-pull).
- Same-day reminders are not yet grouped into one SMS (RG-NOT-02 grouping); quiet hours skip the whole run.
- Publishing a protocol does not proactively recompute existing reminders (they are recomputed at the next write on the subject).
- Telemetry is stored in PostgreSQL (no TimescaleDB); MQTT ingestion is out of scope (HTTP fallback only).
- `provisional_user_id` (OTP verify) and `otp_code` (DELETE /me) are accepted but not used yet.
