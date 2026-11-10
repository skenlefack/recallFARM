import { MigrationInterface, QueryRunner } from 'typeorm';

/** Columns shared by every synchronised table (03 §0.1). */
const SYNCED = `
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  sync_version bigint NOT NULL DEFAULT nextval('sync_version_seq'),
  client_rev integer NOT NULL DEFAULT 0,
  last_device_id text`;

const PARAMETRISED = `
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  param_version text`;

const SYNCED_TABLES = [
  'farms', 'batches', 'dogs', 'animals', 'daily_logs', 'health_events', 'reminders', 'tasks',
  'stock_movements', 'products_sales', 'expenses', 'alert_events', 'param_pack_versions',
];

export class InitSchema1761500000000 implements MigrationInterface {
  name = 'InitSchema1761500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SEQUENCE IF NOT EXISTS sync_version_seq START 1`);
    await q.query(`
      CREATE OR REPLACE FUNCTION rf_bump_sync_version() RETURNS trigger AS $$
      BEGIN
        NEW.sync_version := nextval('sync_version_seq');
        IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);

    // ---- Accounts, organisations, rights -------------------------------------------------
    await q.query(`CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL UNIQUE,
      email text UNIQUE,
      full_name text,
      locale text NOT NULL DEFAULT 'fr',
      country text NOT NULL DEFAULT 'CM',
      default_currency text NOT NULL DEFAULT 'XAF',
      otp_verified boolean NOT NULL DEFAULT false,
      account_status text NOT NULL DEFAULT 'actif',
      platform_roles text[] NOT NULL DEFAULT '{}',
      has_smartphone boolean NOT NULL DEFAULT true,
      analytics_opt_out boolean NOT NULL DEFAULT false,
      last_active_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`);
    await q.query(`CREATE TABLE otp_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC)`);
    await q.query(`CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE organisations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      type text NOT NULL DEFAULT 'cooperative',
      country text NOT NULL DEFAULT 'CM',
      region text,
      currency text NOT NULL DEFAULT 'XAF',
      plan text NOT NULL DEFAULT 'decouverte',
      data_hosting text NOT NULL DEFAULT 'standard',
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`);
    await q.query(`CREATE TABLE memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      organisation_id uuid NOT NULL REFERENCES organisations(id),
      role text NOT NULL,
      farmer_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'actif',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`);
    await q.query(`CREATE UNIQUE INDEX memberships_user_org_uq ON memberships (user_id, organisation_id) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX memberships_org_idx ON memberships (organisation_id)`);
    await q.query(`CREATE TABLE consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      farm_id uuid,
      organisation_id uuid,
      scope text NOT NULL,
      granted boolean NOT NULL,
      text_version text NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      channel text NOT NULL DEFAULT 'app',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX consents_user_idx ON consents (user_id, scope, created_at DESC)`);
    await q.query(`CREATE TABLE account_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      type text NOT NULL,
      status text NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(),
      scheduled_for timestamptz,
      export_uri text,
      completed_at timestamptz
    )`);

    // ---- Farms and livestock -------------------------------------------------------------
    await q.query(`CREATE TABLE farms (${SYNCED},
      owner_id uuid NOT NULL REFERENCES users(id),
      organisation_id uuid REFERENCES organisations(id),
      name text NOT NULL,
      speculations text[] NOT NULL DEFAULT '{}',
      country text NOT NULL DEFAULT 'CM',
      region text,
      locality text,
      currency text NOT NULL DEFAULT 'XAF',
      gps_lat numeric(9,6),
      gps_lng numeric(9,6),
      area_ha numeric(10,2),
      manager_name text
    )`);
    await q.query(`CREATE INDEX farms_owner_idx ON farms (owner_id)`);
    await q.query(`CREATE INDEX farms_org_idx ON farms (organisation_id)`);
    await q.query(`CREATE TABLE farm_settings (
      farm_id uuid PRIMARY KEY REFERENCES farms(id),
      overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
      targets jsonb NOT NULL DEFAULT '{}'::jsonb,
      dashboard_kpis text[] NOT NULL DEFAULT '{}',
      oncall_default jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE batches (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      code text NOT NULL,
      name text NOT NULL,
      species text NOT NULL,
      production_type text,
      strain text,
      initial_count integer NOT NULL CHECK (initial_count >= 1),
      current_count integer,
      mortality_total integer NOT NULL DEFAULT 0,
      start_date date NOT NULL,
      housing text,
      status text NOT NULL DEFAULT 'en_cours'
    )`);
    await q.query(`CREATE INDEX batches_farm_idx ON batches (farm_id)`);
    await q.query(`CREATE TABLE dogs (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      name text NOT NULL,
      breed text,
      sex text NOT NULL CHECK (sex IN ('M','F')),
      birth_date date,
      chip_number text,
      identification_type text,
      coat text,
      status text NOT NULL DEFAULT 'compagnie',
      sire_id uuid,
      dam_id uuid,
      photo_uri text
    )`);
    await q.query(`CREATE INDEX dogs_farm_idx ON dogs (farm_id)`);
    await q.query(`CREATE TABLE animals (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      species text NOT NULL,
      tag text NOT NULL,
      name text,
      sex text NOT NULL CHECK (sex IN ('M','F')),
      breed text,
      birth_date date,
      role text,
      status text NOT NULL DEFAULT 'actif',
      batch_id uuid,
      sire_id uuid,
      dam_id uuid
    )`);
    await q.query(`CREATE INDEX animals_farm_idx ON animals (farm_id)`);

    // ---- Journal, health, reminders, tasks ----------------------------------------------
    await q.query(`CREATE TABLE daily_logs (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      subject_type text NOT NULL,
      subject_id uuid NOT NULL,
      log_date date NOT NULL,
      present_count integer,
      mortality integer NOT NULL DEFAULT 0,
      culled integer NOT NULL DEFAULT 0,
      eggs integer,
      eggs_broken integer,
      milk_l numeric(10,2),
      milk_sold_l numeric(10,2),
      feed_kg numeric(12,3),
      feed_item_id text,
      water_l numeric(12,2),
      temperature_c numeric(5,2),
      notes text,
      measured_fields text[] NOT NULL DEFAULT '{}',
      alert_event_id uuid
    )`);
    await q.query(`CREATE UNIQUE INDEX daily_logs_subject_date_uq ON daily_logs (subject_type, subject_id, log_date) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX daily_logs_farm_idx ON daily_logs (farm_id, log_date)`);
    await q.query(`CREATE TABLE health_events (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      subject_type text NOT NULL,
      subject_id uuid NOT NULL,
      event_type text NOT NULL,
      disease text,
      product text,
      product_batch_no text,
      dose_route text,
      event_date date NOT NULL,
      next_due date,
      withdrawal_meat_until date,
      withdrawal_milk_until date,
      withdrawal_eggs_until date,
      protocol_id text,
      protocol_step text,
      cost_minor bigint,
      currency text,
      performed_by text,
      campaign_id uuid,
      stock_movement_id uuid,
      active_substance_code text,
      quantity_value numeric(12,3),
      quantity_unit text,
      doses_count integer,
      notes text
    )`);
    await q.query(`CREATE INDEX health_events_subject_idx ON health_events (subject_type, subject_id, event_date)`);
    await q.query(`CREATE INDEX health_events_farm_idx ON health_events (farm_id, event_date)`);
    await q.query(`CREATE TABLE reminders (${SYNCED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      source_type text NOT NULL DEFAULT 'health_event',
      source_id uuid,
      subject_type text,
      subject_id uuid,
      subject_ref text,
      protocol_code text,
      step text,
      disease text,
      kind text NOT NULL DEFAULT 'protocole',
      due_date date NOT NULL,
      channel_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'a_venir',
      priority text NOT NULL DEFAULT 'normale',
      short_code text,
      sent_at timestamptz,
      confirmed_at timestamptz,
      confirmed_by uuid,
      confirmed_via text,
      snoozed_until date,
      cancel_reason text,
      health_event_id uuid,
      param_version text
    )`);
    await q.query(`CREATE INDEX reminders_farm_idx ON reminders (farm_id, status, due_date)`);
    await q.query(`CREATE INDEX reminders_due_idx ON reminders (due_date) WHERE status IN ('a_venir','envoye') AND deleted_at IS NULL`);
    await q.query(`CREATE UNIQUE INDEX reminders_open_step_uq ON reminders (subject_type, subject_id, step) WHERE status IN ('a_venir','envoye') AND deleted_at IS NULL`);
    await q.query(`CREATE INDEX reminders_code_idx ON reminders (short_code) WHERE status IN ('a_venir','envoye')`);
    await q.query(`CREATE TABLE tasks (${SYNCED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      template_id text,
      subject_type text,
      subject_id uuid,
      title text NOT NULL,
      category text NOT NULL DEFAULT 'autre',
      due_date date NOT NULL,
      recurrence text,
      assignee_user_id uuid,
      status text NOT NULL DEFAULT 'a_faire',
      done_at timestamptz,
      notes text
    )`);
    await q.query(`CREATE INDEX tasks_farm_idx ON tasks (farm_id, status, due_date)`);

    // ---- Stocks, sales, expenses ---------------------------------------------------------
    await q.query(`CREATE TABLE stock_movements (${SYNCED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      item_id text NOT NULL,
      movement_date date NOT NULL,
      direction text NOT NULL CHECK (direction IN ('entree','sortie','ajustement')),
      quantity numeric(14,3) NOT NULL,
      unit_cost_minor bigint,
      currency text,
      supplier text,
      lot_no text,
      expiry_date date,
      subject_type text,
      subject_id uuid,
      expense_id uuid,
      health_event_id uuid,
      notes text
    )`);
    await q.query(`CREATE INDEX stock_movements_farm_idx ON stock_movements (farm_id, item_id)`);
    await q.query(`CREATE TABLE stock_thresholds (
      farm_id uuid NOT NULL REFERENCES farms(id),
      item_id text NOT NULL,
      min_quantity numeric(14,3) NOT NULL,
      PRIMARY KEY (farm_id, item_id)
    )`);
    await q.query(`CREATE TABLE products_sales (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      product text NOT NULL,
      species text,
      quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL,
      unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
      amount_minor bigint NOT NULL,
      currency text NOT NULL,
      client_id uuid,
      client_name text,
      payment text,
      payment_status text NOT NULL DEFAULT 'paye',
      sale_date date NOT NULL,
      subject_type text,
      subject_id uuid
    )`);
    await q.query(`CREATE INDEX sales_farm_idx ON products_sales (farm_id, sale_date)`);
    await q.query(`CREATE TABLE expenses (${SYNCED}, ${PARAMETRISED},
      farm_id uuid NOT NULL REFERENCES farms(id),
      category text NOT NULL,
      description text,
      quantity numeric(14,3),
      amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
      currency text NOT NULL,
      payment_method text,
      supplier text,
      expense_date date NOT NULL,
      subject_type text,
      subject_id uuid
    )`);
    await q.query(`CREATE INDEX expenses_farm_idx ON expenses (farm_id, expense_date)`);

    // ---- Alerts and remote monitoring ----------------------------------------------------
    await q.query(`CREATE TABLE alert_events (${SYNCED},
      farm_id uuid REFERENCES farms(id),
      organisation_id uuid,
      rule_code text NOT NULL,
      source text NOT NULL,
      severity text NOT NULL,
      status text NOT NULL DEFAULT 'ouverte',
      title text,
      reason text,
      action_label text,
      trigger_value jsonb NOT NULL DEFAULT '{}'::jsonb,
      subject_type text,
      subject_id uuid,
      device_id uuid,
      opened_at timestamptz NOT NULL DEFAULT now(),
      last_triggered_at timestamptz,
      repeat_count integer NOT NULL DEFAULT 0,
      acknowledged_by uuid,
      acknowledged_at timestamptz,
      resolved_at timestamptz,
      resolution_cause text,
      resolution_action text,
      escalation jsonb NOT NULL DEFAULT '[]'::jsonb,
      origin text NOT NULL DEFAULT 'serveur',
      param_version text
    )`);
    await q.query(`CREATE INDEX alert_events_farm_idx ON alert_events (farm_id, status)`);
    await q.query(`CREATE INDEX alert_events_org_idx ON alert_events (organisation_id, status)`);
    await q.query(`CREATE TABLE devices (
      id uuid PRIMARY KEY,
      farm_id uuid NOT NULL REFERENCES farms(id),
      type text NOT NULL,
      name text NOT NULL,
      serial text,
      housing text,
      sensor_profile_code text,
      metric text,
      unit text,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      key_hash text,
      status text NOT NULL DEFAULT 'en_ligne',
      last_seen_at timestamptz,
      last_value double precision,
      breach_since timestamptz,
      battery_pct integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`);
    await q.query(`CREATE INDEX devices_farm_idx ON devices (farm_id)`);
    await q.query(`CREATE TABLE telemetry (
      device_id uuid NOT NULL REFERENCES devices(id),
      metric text NOT NULL,
      ts timestamptz NOT NULL,
      value double precision NOT NULL,
      quality smallint NOT NULL DEFAULT 1,
      PRIMARY KEY (device_id, metric, ts)
    )`);

    // ---- Genealogy -----------------------------------------------------------------------
    await q.query(`CREATE TABLE mating_checks (
      id uuid PRIMARY KEY,
      farm_id uuid,
      species text NOT NULL,
      sire_type text NOT NULL,
      sire_id uuid NOT NULL,
      dam_type text NOT NULL,
      dam_id uuid NOT NULL,
      expected_coef numeric(8,6) NOT NULL,
      complete boolean NOT NULL,
      generations_used integer NOT NULL,
      threshold numeric(6,4) NOT NULL,
      verdict text NOT NULL,
      common_ancestors jsonb NOT NULL DEFAULT '[]'::jsonb,
      checked_at timestamptz NOT NULL DEFAULT now(),
      checked_by uuid
    )`);

    // ---- Billing -------------------------------------------------------------------------
    await q.query(`CREATE TABLE subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_type text NOT NULL,
      account_id uuid NOT NULL,
      plan text NOT NULL,
      period text NOT NULL DEFAULT 'mensuel',
      price_minor bigint,
      currency text,
      payment_provider text,
      started_at timestamptz,
      expires_at timestamptz,
      grace_until timestamptz,
      status text NOT NULL DEFAULT 'actif',
      entitlements_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE UNIQUE INDEX subscriptions_account_uq ON subscriptions (account_type, account_id)`);
    await q.query(`CREATE TABLE payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payer_type text NOT NULL,
      payer_id uuid NOT NULL,
      purpose text NOT NULL DEFAULT 'abonnement',
      subscription_id uuid,
      plan text,
      period text,
      amount_minor bigint NOT NULL,
      currency text NOT NULL,
      method text NOT NULL,
      phone text,
      provider_ref text,
      status text NOT NULL DEFAULT 'initie',
      paid_at timestamptz,
      fees_minor bigint,
      created_by uuid,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    // ---- Notifications -------------------------------------------------------------------
    await q.query(`CREATE TABLE outbound_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reminder_id uuid,
      alert_event_id uuid,
      organisation_id uuid,
      recipient_user_id uuid,
      recipient_phone text NOT NULL,
      channel text NOT NULL,
      template_code text NOT NULL,
      lang text NOT NULL DEFAULT 'fr',
      body text,
      status text NOT NULL DEFAULT 'en_file',
      plan_offset integer,
      provider_ref text,
      cost_minor bigint,
      currency text,
      queued_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      delivered_at timestamptz,
      error_code text
    )`);
    await q.query(`CREATE INDEX outbound_reminder_idx ON outbound_messages (reminder_id, plan_offset, channel)`);
    await q.query(`CREATE INDEX outbound_recipient_idx ON outbound_messages (recipient_phone, queued_at)`);
    await q.query(`CREATE TABLE usage_counters (
      account_type text NOT NULL,
      account_id uuid NOT NULL,
      period text NOT NULL,
      metric text NOT NULL,
      value integer NOT NULL DEFAULT 0,
      PRIMARY KEY (account_type, account_id, period, metric)
    )`);

    // ---- Parametrisation -----------------------------------------------------------------
    await q.query(`CREATE TABLE param_packs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      level text NOT NULL,
      scope_ref text,
      title text,
      owner_user_id uuid,
      review_required boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE param_pack_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      sync_version bigint NOT NULL DEFAULT nextval('sync_version_seq'),
      pack_id uuid NOT NULL REFERENCES param_packs(id),
      version text NOT NULL,
      status text NOT NULL DEFAULT 'brouillon',
      content jsonb NOT NULL,
      content_hash text,
      signature text,
      requires jsonb NOT NULL DEFAULT '{}'::jsonb,
      changelog text,
      author_id uuid,
      published_by uuid,
      published_at timestamptz,
      retired_at timestamptz,
      rollout jsonb,
      UNIQUE (pack_id, version)
    )`);
    await q.query(`CREATE TABLE param_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES param_pack_versions(id),
      reviewer_id uuid NOT NULL,
      decision text NOT NULL,
      comments text,
      reviewed_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE param_test_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES param_pack_versions(id),
      kind text NOT NULL,
      passed boolean NOT NULL,
      report jsonb NOT NULL DEFAULT '{}'::jsonb,
      ran_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE param_publications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id uuid NOT NULL REFERENCES param_pack_versions(id),
      action text NOT NULL,
      actor_id uuid,
      at timestamptz NOT NULL DEFAULT now(),
      reason text
    )`);
    await q.query(`CREATE TABLE param_override_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      farm_id uuid,
      object_ref text NOT NULL,
      property text NOT NULL,
      attempted_value jsonb,
      policy text NOT NULL,
      by_pack text,
      at timestamptz NOT NULL DEFAULT now()
    )`);

    // ---- Sync, audit, jobs, analytics ----------------------------------------------------
    await q.query(`CREATE TABLE sync_receipts (
      entity text NOT NULL,
      entity_id uuid NOT NULL,
      client_rev integer NOT NULL,
      device_id text,
      user_id uuid,
      outcome jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_id, client_rev)
    )`);
    await q.query(`CREATE TABLE audit_log (
      id bigserial PRIMARY KEY,
      entity text NOT NULL,
      entity_id uuid,
      action text NOT NULL,
      actor_id uuid,
      actor_role text,
      on_behalf_of_farm_id uuid,
      at timestamptz NOT NULL DEFAULT now(),
      diff jsonb
    )`);
    await q.query(`CREATE TABLE import_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      organisation_id uuid,
      farm_id uuid,
      status text NOT NULL DEFAULT 'valide',
      rows_total integer NOT NULL DEFAULT 0,
      rows_ok integer NOT NULL DEFAULT 0,
      rows jsonb NOT NULL DEFAULT '[]'::jsonb,
      errors jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      committed_at timestamptz
    )`);
    await q.query(`CREATE TABLE export_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      requested_by uuid,
      scope jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'en_file',
      file_uri text,
      file_hash text,
      rows integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )`);
    await q.query(`CREATE TABLE analytics_events (
      id bigserial PRIMARY KEY,
      user_id uuid,
      device_id_hash text,
      name text NOT NULL,
      ts timestamptz NOT NULL,
      props jsonb NOT NULL DEFAULT '{}'::jsonb,
      received_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE feature_flags (
      key text PRIMARY KEY,
      description text,
      rules jsonb NOT NULL DEFAULT '{}'::jsonb,
      enabled boolean NOT NULL DEFAULT true,
      updated_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text NOT NULL,
      name text,
      source text NOT NULL,
      ip_hash text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    // GIN indexes on parametrised attributes (03 §0.4).
    for (const t of ['batches', 'dogs', 'animals', 'daily_logs', 'health_events', 'products_sales', 'expenses']) {
      await q.query(`CREATE INDEX ${t}_attributes_gin ON ${t} USING gin (attributes)`);
    }
    for (const t of SYNCED_TABLES) {
      await q.query(`CREATE INDEX ${t}_sync_version_idx ON ${t} (sync_version)`);
      await q.query(`CREATE TRIGGER ${t}_sync_version BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION rf_bump_sync_version()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const tables = [
      'leads', 'feature_flags', 'analytics_events', 'export_jobs', 'import_jobs', 'audit_log', 'sync_receipts',
      'param_override_events', 'param_publications', 'param_test_runs', 'param_reviews', 'param_pack_versions', 'param_packs',
      'usage_counters', 'outbound_messages', 'payments', 'subscriptions', 'mating_checks', 'telemetry', 'devices',
      'alert_events', 'expenses', 'products_sales', 'stock_thresholds', 'stock_movements', 'tasks', 'reminders',
      'health_events', 'daily_logs', 'animals', 'dogs', 'batches', 'farm_settings', 'farms', 'account_requests', 'consents',
      'memberships', 'organisations', 'refresh_tokens', 'otp_codes', 'users',
    ];
    for (const t of tables) await q.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await q.query(`DROP FUNCTION IF EXISTS rf_bump_sync_version()`);
    await q.query(`DROP SEQUENCE IF EXISTS sync_version_seq`);
  }
}
