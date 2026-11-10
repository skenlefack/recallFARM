import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, hasPlatformRole } from '../common/auth';
import { todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { KeysService } from '../common/keys.service';
import { config } from '../config';
import { ParamPack, ParamPackVersion, ParamPublication, ParamReview, ParamTestRun } from '../database/entities';
import { RemindersService } from '../health/reminders.service';
import { evaluate } from '../params/expr';
import { loadVectors } from '../params/engine/packs-loader';
import { computeProtocolReminders, DiseaseInfo, notificationPlan, Protocol, ReminderPlan } from '../params/engine/reminders';
import { getObject, getPath, objectsOfKind, resolvePacks, selectPacks } from '../params/engine/resolution';
import { PackDoc } from '../params/engine/types';
import { ParamsService } from '../params/params.service';
import { diffPacks, validatePack } from './pack-validation';

const HIGH_LEVELS = ['global', 'filiere', 'pays'];
const AUTHOR_ROLES = ['param_author', 'param_publisher', 'referent_sanitaire'];
const REVIEWER_ROLES = ['param_reviewer', 'referent_sanitaire', 'param_publisher'];

function diseasesAct(resolved: ReturnType<typeof resolvePacks>, code: string): boolean {
  return !!(resolved.objects[`disease:${code}`] as { act?: boolean } | undefined)?.act;
}

function addDaysStr(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

function bumpPatch(v: string): string {
  const [a, b, c] = v.split('.').map(Number);
  return `${a}.${b}.${(c || 0) + 1}`;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Parameter studio: drafts, validation, tests, four-eyes review (RG-PAR-04), publication, rollback (RG-PAR-06). */
@Injectable()
export class StudioService {
  private readonly logger = new Logger('StudioService');

  constructor(
    private readonly ds: DataSource,
    private readonly params: ParamsService,
    private readonly keys: KeysService,
    private readonly access: AccessService,
    private readonly reminders: RemindersService,
  ) {}

  private async pack(code: string): Promise<ParamPack> {
    const p = await this.ds.getRepository(ParamPack).findOne({ where: { code } });
    if (!p) throw Errors.notFound('Pack');
    return p;
  }

  private async version(id: string): Promise<{ v: ParamPackVersion; pack: ParamPack }> {
    const v = await this.ds.getRepository(ParamPackVersion).findOne({ where: { id } });
    if (!v) throw Errors.notFound('Version');
    const pack = (await this.ds.getRepository(ParamPack).findOne({ where: { id: v.pack_id } }))!;
    return { v, pack };
  }

  /** Org admins may edit their organisation's pack (S09); platform roles edit everything else. */
  private async assertCanAuthor(user: AuthUser, pack: ParamPack): Promise<void> {
    if (hasPlatformRole(user, ...AUTHOR_ROLES)) return;
    if (pack.level === 'org' && pack.scope_ref) {
      await this.access.assertOrgManager(user, pack.scope_ref);
      return;
    }
    throw Errors.forbidden('Rôle param_author requis');
  }

  /** Org packs: review required when the pack or its organisation (settings.review_required) asks for it. */
  private async reviewRequired(pack: ParamPack): Promise<boolean> {
    if (pack.review_required) return true;
    if (pack.level !== 'org' || !pack.scope_ref) return false;
    const rows: Array<{ rr: boolean | null }> = await this.ds.query(`SELECT (settings->>'review_required')::boolean AS rr FROM organisations WHERE id::text = $1`, [pack.scope_ref]);
    return !!rows[0]?.rr;
  }

  async listPacks(user: AuthUser) {
    const rows: Array<Record<string, unknown>> = await this.ds.query(
      `SELECT p.code, p.level, p.scope_ref, p.title, p.review_required,
              (SELECT v.version FROM param_pack_versions v WHERE v.pack_id = p.id AND v.status = 'publie' AND v.rollout IS NULL ORDER BY v.published_at DESC LIMIT 1) AS published_version,
              (SELECT json_agg(json_build_object('id', v.id, 'version', v.version, 'status', v.status) ORDER BY v.created_at DESC)
                 FROM param_pack_versions v WHERE v.pack_id = p.id AND v.status IN ('brouillon','en_revue','teste')) AS open_versions,
              (SELECT json_build_object('id', v.id, 'version', v.version, 'status', v.status)
                 FROM param_pack_versions v WHERE v.pack_id = p.id AND v.status IN ('brouillon','en_revue','teste') ORDER BY v.created_at DESC LIMIT 1) AS draft,
              (SELECT v.requires FROM param_pack_versions v WHERE v.pack_id = p.id ORDER BY v.created_at DESC LIMIT 1) AS requires,
              (SELECT max(v.updated_at) FROM param_pack_versions v WHERE v.pack_id = p.id) AS updated_at,
              (SELECT count(*)::int FROM farms f WHERE f.deleted_at IS NULL AND (
                  p.level = 'global'
                  OR (p.level = 'pays' AND f.country = p.scope_ref)
                  OR (p.level = 'org' AND f.organisation_id::text = p.scope_ref)
                  OR (p.level = 'filiere' AND f.speculations && (CASE p.scope_ref WHEN 'volaille' THEN ARRAY['volaille','aviculture'] WHEN 'canin' THEN ARRAY['chien','elevage_canin','dressage','pension_canine'] ELSE ARRAY[p.scope_ref] END)))) AS adoption_farms,
              (SELECT count(*)::int FROM jsonb_array_elements((SELECT v.content->'objects' FROM param_pack_versions v WHERE v.pack_id = p.id AND v.status = 'publie' ORDER BY v.published_at DESC LIMIT 1))) AS objects
         FROM param_packs p ORDER BY CASE p.level WHEN 'global' THEN 0 WHEN 'filiere' THEN 1 WHEN 'pays' THEN 2 ELSE 3 END, p.code`,
    );
    if (hasPlatformRole(user, ...AUTHOR_ROLES, ...REVIEWER_ROLES)) return rows;
    const orgs: Array<{ organisation_id: string }> = await this.ds.query(`SELECT organisation_id FROM memberships WHERE user_id = $1 AND status = 'actif' AND role = 'admin'`, [user.id]);
    if (!orgs.length) throw Errors.forbidden('Accès au studio réservé');
    return rows.filter((r) => r.level !== 'org' || orgs.some((o) => o.organisation_id === r.scope_ref));
  }

  async versions(user: AuthUser, code: string) {
    const pack = await this.pack(code);
    const list = await this.ds.getRepository(ParamPackVersion).find({ where: { pack_id: pack.id }, order: { created_at: 'DESC' } });
    return list.map((v) => this.serialize(v, pack));
  }

  serialize(v: ParamPackVersion, pack: ParamPack, withContent = false) {
    return {
      id: v.id,
      pack: pack.code,
      level: pack.level,
      version: v.version,
      status: v.status,
      content_hash: v.content_hash,
      signature: v.signature,
      changelog: v.changelog,
      author_id: v.author_id,
      published_by: v.published_by,
      published_at: v.published_at,
      retired_at: v.retired_at,
      rollout: v.rollout,
      created_at: v.created_at,
      updated_at: v.updated_at,
      ...(withContent ? { content: v.content } : {}),
    };
  }

  async get(_user: AuthUser, id: string) {
    const { v, pack } = await this.version(id);
    const reviews: Array<Record<string, unknown>> = await this.ds.query(
      `SELECT r.*, u.full_name AS reviewer_name FROM param_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.version_id = $1 ORDER BY r.reviewed_at`,
      [id],
    );
    const tests = await this.ds.getRepository(ParamTestRun).find({ where: { version_id: id }, order: { ran_at: 'DESC' }, take: 10 });
    const names: Array<{ id: string; full_name: string | null }> = await this.ds.query(`SELECT id, full_name FROM users WHERE id = ANY($1)`, [
      [v.author_id, v.published_by].filter(Boolean),
    ]);
    const name = (uid: string | null) => names.find((n) => n.id === uid)?.full_name ?? null;
    return {
      ...this.serialize(v, pack, true),
      author_name: name(v.author_id),
      published_by_name: name(v.published_by),
      rollout_pct: v.status === 'publie' ? (v.rollout?.percent ?? 100) : (v.rollout?.percent ?? null),
      assigned_reviewer_name: /demandée à ([^.]+)/.exec(v.changelog ?? '')?.[1]?.trim() ?? null,
      reviews,
      tests,
    };
  }

  async createDraft(user: AuthUser, code: string, body: { version?: string; changelog?: string }) {
    const pack = await this.pack(code);
    await this.assertCanAuthor(user, pack);
    const repo = this.ds.getRepository(ParamPackVersion);
    const all = await repo.find({ where: { pack_id: pack.id } });
    if (!all.length) throw Errors.notFound('Version de base');
    const latest = all.sort((a, b) => cmpSemver(b.version, a.version))[0];
    const version = body.version ?? bumpPatch(latest.version);
    if (all.some((v) => v.version === version)) throw Errors.conflict(`La version ${version} existe déjà`, { existing_version: version });
    if (cmpSemver(version, latest.version) <= 0) throw Errors.validation({ version: `doit être supérieure à ${latest.version}` });
    const content = { ...(latest.content as Record<string, unknown>), version };
    const v = await repo.save(
      repo.create({ pack_id: pack.id, version, status: 'brouillon', content, requires: latest.requires, changelog: body.changelog ?? null, author_id: user.id }),
    );
    return this.serialize(v, pack, true);
  }

  async patch(user: AuthUser, id: string, body: { content: Record<string, unknown>; changelog?: string }) {
    const { v, pack } = await this.version(id);
    if (v.status !== 'brouillon') throw Errors.business('RG-PAR-03', 'Seul un brouillon est modifiable (contenu publié immuable)', { status: v.status });
    if (v.author_id !== user.id && !hasPlatformRole(user)) await this.assertCanAuthor(user, pack);
    v.content = { ...body.content, pack: pack.code, version: v.version, level: pack.level };
    v.requires = (body.content.requires as Record<string, string>) ?? v.requires;
    if (body.changelog !== undefined) v.changelog = body.changelog;
    await this.ds.getRepository(ParamPackVersion).save(v);
    return this.serialize(v, pack, true);
  }

  /** Base stack (published packs) with `doc` inserted at its level in place of the same pack. */
  private async stackWith(pack: ParamPack): Promise<(doc: PackDoc) => PackDoc[]> {
    const published = (await this.params.publishedPacks()).filter((p) => !p.rollout).map((p) => p.doc);
    return (doc: PackDoc) => {
      const others = published.filter((p) => p.pack !== doc.pack);
      const country = pack.level === 'pays' ? (doc.country ?? pack.scope_ref ?? 'CM') : 'CM';
      const base = selectPacks(others.filter((p) => p.level !== 'org'), { country, speculations: ['volaille', 'chien'] });
      const order = ['global', 'filiere', 'pays', 'org'];
      const idx = base.findIndex((p) => order.indexOf(p.level) > order.indexOf(doc.level));
      if (idx < 0) base.push(doc);
      else base.splice(idx, 0, doc);
      return base;
    };
  }

  async validate(_user: AuthUser, id: string) {
    const { v, pack } = await this.version(id);
    const published = (await this.params.publishedPacks()).map((p) => ({ pack: p.doc.pack, version: p.doc.version }));
    const stackWith = await this.stackWith(pack);
    const doc = v.content as unknown as PackDoc;
    // Objects already defined by upper levels are overrides: only the properties they change are checked.
    const inherited = new Set(Object.keys(resolvePacks(stackWith(doc).filter((p) => p.pack !== doc.pack)).objects));
    const errors = validatePack(doc, { code: pack.code, level: pack.level }, stackWith, published, inherited);
    await this.ds.getRepository(ParamTestRun).save({ version_id: v.id, kind: 'schema', passed: errors.length === 0, report: { errors } });
    return { valid: errors.length === 0, errors };
  }

  /** Runs the shared vectors with the draft in the stack + a protocol timeline simulation. */
  async test(user: AuthUser, id: string) {
    const { v, pack } = await this.version(id);
    const doc = v.content as unknown as PackDoc;
    const stackWith = await this.stackWith(pack);
    const runs: Array<{ kind: string; passed: boolean; report: Record<string, unknown> }> = [];
    const schema = await this.validate(user, id);
    runs.push({ kind: 'schema', passed: schema.valid, report: { errors: schema.errors } });

    const vdir = config().vectorsDir;
    // Expression vectors: the evaluator is shared, they guard engine parity (cross_engine).
    const ev = loadVectors('expressions', vdir);
    const exprFails = (ev.cases as Array<{ expr: string; value?: unknown; error?: string }>).filter((c) => {
      const r = evaluate(c.expr, ev.context);
      return c.error ? r.ok || (r as { error: string }).error !== c.error : !r.ok || JSON.stringify(r.value) !== JSON.stringify(c.value);
    });
    runs.push({ kind: 'cross_engine', passed: exprFails.length === 0, report: { total: ev.cases.length, failed: exprFails.map((c) => c.expr) } });

    // Resolution vectors with the candidate replacing its published version.
    const rv = loadVectors('resolution', vdir);
    const resFails: string[] = [];
    for (const c of rv.cases as any[]) {
      const stack = selectPacks(stackWith(doc), c.farm);
      if (c.org_pack) stack.push(c.org_pack);
      const r = resolvePacks(stack, c.farm_settings ?? null);
      const exp = c.expect;
      let ok = true;
      if (exp.param_version && !exp.param_version.split('+').every((p: string) => r.param_version.includes(p.split('@')[0]))) ok = false;
      if (exp.kind_code) {
        const obj = r.objects[exp.kind_code];
        if (!obj) ok = false;
        else
          for (const [k, val] of Object.entries(exp)) {
            if (['kind_code', 'rejected', 'param_version'].includes(k)) continue;
            if (k === 'step_codes') ok &&= JSON.stringify((obj.steps as any[]).map((s) => s.code)) === JSON.stringify(val);
            else if (k === 'step_offsets') ok &&= Object.entries(val as Record<string, number>).every(([code, off]) => (obj.steps as any[]).find((s) => s.code === code)?.offset_days === off);
            else ok &&= JSON.stringify(getPath(obj, k)) === JSON.stringify(val);
          }
      }
      if (exp.rejected) ok &&= JSON.stringify(r.rejected) === JSON.stringify(exp.rejected);
      if (!ok) resFails.push(c.name);
    }
    runs.push({ kind: 'resolution', passed: resFails.length === 0, report: { total: rv.cases.length, failed: resFails } });

    // Reminder vectors (golden) with the candidate in the stack.
    const mv = loadVectors('reminders', vdir);
    const resolved = resolvePacks(selectPacks(stackWith(doc), { country: 'CM', speculations: ['volaille', 'chien'] }));
    const diseases: Record<string, DiseaseInfo> = {};
    objectsOfKind<DiseaseInfo>(resolved, 'disease').forEach((d) => (diseases[d.code] = d));
    const remFails: string[] = [];
    for (const c of mv.cases as any[]) {
      const proto = getObject<Protocol>(resolved, 'vaccination_protocol', c.protocol);
      const out = proto
        ? computeProtocolReminders(proto, c.subject, c.events, c.today, diseases).map(({ step, disease, due_date, status, priority, kind }) => ({ step, disease, due_date, status, priority, kind }))
        : null;
      if (JSON.stringify(out) !== JSON.stringify(c.expected)) remFails.push(c.name);
    }
    runs.push({ kind: 'golden', passed: remFails.length === 0, report: { total: mv.cases.length, failed: remFails } });

    // Timeline simulation of every protocol of the candidate.
    const timelines = objectsOfKind<Protocol>(resolved, 'vaccination_protocol')
      .filter((p) => doc.objects.some((o) => o.kind === 'vaccination_protocol' && o.code === p.code))
      .map((p) => ({ protocol: p.code, timeline: this.timeline(resolved, p, '2026-11-01') }));
    runs.push({ kind: 'simulation', passed: true, report: { timelines } });

    const repo = this.ds.getRepository(ParamTestRun);
    for (const r of runs.slice(1)) await repo.save({ version_id: v.id, kind: r.kind, passed: r.passed, report: r.report });
    const passed = runs.every((r) => r.passed);
    const results = runs.map((r) => ({
      name: r.kind,
      ok: r.passed,
      ...(r.passed ? {} : { message: JSON.stringify((r.report as { failed?: unknown; errors?: unknown }).failed ?? (r.report as { errors?: unknown }).errors) }),
    }));
    return { passed, total: runs.length, results, runs };
  }

  private timeline(resolved: ReturnType<typeof resolvePacks>, p: Protocol, start: string) {
    const diseases: Record<string, DiseaseInfo> = {};
    objectsOfKind<DiseaseInfo>(resolved, 'disease').forEach((d) => (diseases[d.code] = d));
    const plan = objectsOfKind<ReminderPlan>(resolved, 'reminder_plan')[0];
    const subject = { start_date: start, birth_date: start, created_at: start };
    const steps = computeProtocolReminders(p, subject, [], start, diseases);
    // Show the first recurring occurrence as if the anchor step had been done on time.
    if (p.recurring?.after_step) {
      const anchor = steps.find((s) => s.step === p.recurring!.after_step);
      if (anchor) {
        const rec = computeProtocolReminders(p, subject, [{ protocol_step: anchor.step, disease: anchor.disease, event_date: anchor.due_date }], start, diseases).find((s) => s.kind === 'recurrent');
        if (rec) steps.push(rec);
      }
    }
    return steps.map((s) => ({
      step: s.step,
      disease: s.disease,
      label: resolved.i18n.fr?.[s.disease] ?? s.disease,
      due_date: s.due_date,
      day: Math.round((Date.parse(s.due_date) - Date.parse(start)) / 86400_000),
      kind: s.kind,
      priority: s.priority,
      route: s.route ?? null,
      notifications: plan ? notificationPlan(plan, s.due_date, ['rappels_sms']) : [],
    }));
  }

  async simulateProtocol(_user: AuthUser, body: { version_id: string; protocol_code: string; birth_or_start_date: string }) {
    const { v, pack } = await this.version(body.version_id);
    const stack = (await this.stackWith(pack))(v.content as unknown as PackDoc);
    const resolved = resolvePacks(selectPacks(stack, { country: 'CM', speculations: ['volaille', 'chien'] }));
    const p = getObject<Protocol>(resolved, 'vaccination_protocol', body.protocol_code);
    if (!p) throw Errors.notFound('Protocole');
    const timeline = this.timeline(resolved, p, body.birth_or_start_date);
    const plan = objectsOfKind<ReminderPlan>(resolved, 'reminder_plan')[0];
    const steps = (p.steps ?? []) as Array<Record<string, unknown>>;
    const events = timeline.map((t) => {
      const step = steps.find((s) => s.code === t.step);
      const type = (step?.type as string | undefined) ?? (t.disease === 'vermifugation' || (diseasesAct(resolved, t.disease)) ? 'soin' : 'vaccin');
      return {
        step: t.step,
        label: (step?.label as string | undefined) ?? `${t.label}${t.kind === 'recurrent' ? ' (rappel)' : ''}`,
        offset_days: t.day,
        due_date: t.due_date,
        kind: type,
        conditional: !!step?.condition,
        condition: (step?.condition as string | undefined) ?? null,
        after_step: (step?.after_step as string | undefined) ?? (t.kind === 'recurrent' ? (p.recurring?.after_step ?? null) : null),
        priority: t.priority,
        notifications: t.notifications,
      };
    });
    const end = (p as unknown as { end?: { label: string; offset_days: number } }).end;
    if (end) events.push({ step: 'fin', label: end.label, offset_days: end.offset_days, due_date: addDaysStr(body.birth_or_start_date, end.offset_days), kind: 'jalon', conditional: false, condition: null, after_step: null, priority: 'normale', notifications: [] });
    return {
      protocol: p.code,
      reference: p.reference,
      start: body.birth_or_start_date,
      provenance: resolved.provenance[`vaccination_protocol:${p.code}`],
      events,
      reminder_offsets: plan?.offsets_days ?? [],
      withdrawal_applied: !!((p as unknown as Record<string, unknown>).withdrawal_meat || steps.some((s) => s.withdrawal_meat_days || s.withdrawal_meat)),
      timeline,
    };
  }

  async submit(user: AuthUser, id: string) {
    const { v, pack } = await this.version(id);
    if (v.status !== 'brouillon') throw Errors.business('RG-PAR-04', 'Seul un brouillon peut être soumis', { status: v.status });
    if (v.author_id !== user.id && !hasPlatformRole(user)) await this.assertCanAuthor(user, pack);
    const check = await this.validate(user, id);
    if (!check.valid) throw Errors.business('RG-PAR-01', 'Le pack ne passe pas la validation', { errors: check.errors });
    v.status = 'en_revue';
    await this.ds.getRepository(ParamPackVersion).save(v);
    return this.serialize(v, pack);
  }

  async review(user: AuthUser, id: string, body: { decision: string; comments?: string }) {
    const { v, pack } = await this.version(id);
    if (!['en_revue', 'teste'].includes(v.status)) throw Errors.business('RG-PAR-04', 'La version n’est pas en revue', { status: v.status });
    if (v.author_id === user.id) {
      // RG-PAR-04: an author never reviews their own version, whatever the level.
      throw Errors.business('RG-PAR-04', 'L’auteur ne peut pas relire son propre pack (règle des quatre yeux)');
    }
    if (pack.level === 'org' && pack.scope_ref && !hasPlatformRole(user, ...REVIEWER_ROLES)) await this.access.assertOrgManager(user, pack.scope_ref);
    else if (pack.level !== 'org' && !hasPlatformRole(user, ...REVIEWER_ROLES)) throw Errors.forbidden('Rôle param_reviewer requis');
    const r = await this.ds.getRepository(ParamReview).save({ version_id: v.id, reviewer_id: user.id, decision: body.decision, comments: body.comments ?? null });
    if (body.decision === 'refuse') {
      v.status = 'brouillon';
      await this.ds.getRepository(ParamPackVersion).save(v);
    } else if (body.decision === 'approuve') {
      v.status = 'teste'; // approved, ready to publish
      await this.ds.getRepository(ParamPackVersion).save(v);
    }
    return { review: r, version: this.serialize(v, pack) };
  }

  async publish(user: AuthUser, id: string, body: { rollout_pct?: number }) {
    const { v, pack } = await this.version(id);
    // RG-PAR-04 first: an author never publishes alone a global/filière/pays pack, nor an org pack whose review is required.
    const reviewRequired = HIGH_LEVELS.includes(pack.level) || (await this.reviewRequired(pack));
    if (reviewRequired && v.author_id === user.id) {
      throw Errors.business('RG-PAR-04', 'L’auteur ne peut pas publier seul un pack global, filière ou pays (règle des quatre yeux)');
    }
    if (pack.level === 'org' && pack.scope_ref && !hasPlatformRole(user, 'param_publisher')) await this.access.assertOrgManager(user, pack.scope_ref);
    else if (pack.level !== 'org' && !hasPlatformRole(user, 'param_publisher')) throw Errors.forbidden('Rôle param_publisher requis');
    if (!['en_revue', 'teste'].includes(v.status) && !(pack.level === 'org' && !reviewRequired && v.status === 'brouillon')) {
      throw Errors.business('RG-PAR-04', 'La version doit être en revue avant publication', { status: v.status });
    }
    if (reviewRequired) {
      const approvals = await this.ds.getRepository(ParamReview).find({ where: { version_id: v.id, decision: 'approuve' } });
      if (!approvals.some((a) => a.reviewer_id !== v.author_id)) {
        throw Errors.business('RG-PAR-04', 'Une relecture approuvée par une autre personne que l’auteur est requise');
      }
    }
    const check = await this.validate(user, id);
    if (!check.valid) throw Errors.business('RG-PAR-01', 'Le pack ne passe pas la validation', { errors: check.errors });
    const rolloutPct = body.rollout_pct !== undefined && body.rollout_pct < 100 ? body.rollout_pct : null;
    const { hash, signature } = this.keys.signPack(v.content);
    await this.ds.transaction(async (m) => {
      if (rolloutPct === null) {
        await m.getRepository(ParamPackVersion).update({ pack_id: pack.id, status: 'publie' }, { status: 'retire', retired_at: new Date() });
      }
      v.status = 'publie';
      v.content_hash = hash;
      v.signature = signature;
      v.published_by = user.id;
      v.published_at = new Date();
      v.rollout = rolloutPct === null ? null : { percent: rolloutPct };
      await m.getRepository(ParamPackVersion).save(v);
      await m.getRepository(ParamPublication).save({ version_id: v.id, action: rolloutPct === null ? 'publish' : 'rollout_change', actor_id: user.id, reason: rolloutPct === null ? null : `rollout ${rolloutPct}%` });
    });
    this.params.invalidate();

    // Background: recompute open reminders for subjects affected by changed vaccination protocols.
    const content = v.content as unknown as PackDoc;
    const protocolCodes = content.objects
      .filter((o) => o.kind === 'vaccination_protocol')
      .map((o) => o.code);
    if (protocolCodes.length > 0) {
      this.recomputeAffectedReminders(protocolCodes, content).catch((e) =>
        this.logger.error(`Reminder recomputation failed: ${(e as Error).message}`),
      );
    }

    return this.serialize(v, pack);
  }

  /**
   * Recomputes open reminders for subjects whose protocol has changed.
   * Returns a count of affected subjects (logged for observability).
   */
  async recomputeAffectedReminders(protocolCodes: string[], content: PackDoc): Promise<number> {
    let affected = 0;
    const today = todayIn();

    for (const code of protocolCodes) {
      const proto = content.objects.find((o) => o.kind === 'vaccination_protocol' && o.code === code) as
        | { species?: string; production_type?: string }
        | undefined;
      if (!proto) continue;

      // Find subjects that have open reminders referencing this protocol
      const subjects: Array<{ subject_type: string; subject_id: string }> = await this.ds.query(
        `SELECT DISTINCT r.subject_type, r.subject_id FROM reminders r
          WHERE r.protocol_code = $1 AND r.status IN ('a_venir', 'envoye') AND r.deleted_at IS NULL`,
        [code],
      );

      for (const s of subjects) {
        try {
          await this.reminders.recompute(s.subject_type, s.subject_id, { today });
          affected++;
        } catch (e) {
          this.logger.warn(`Recompute failed for ${s.subject_type}/${s.subject_id}: ${(e as Error).message}`);
        }
      }
    }

    this.logger.log(`Protocol publish: recomputed reminders for ${affected} subjects (protocols: ${protocolCodes.join(', ')})`);
    return affected;
  }

  async rollback(user: AuthUser, code: string, body: { to_version: string; reason: string }) {
    const pack = await this.pack(code);
    if (pack.level === 'org' && pack.scope_ref && !hasPlatformRole(user, 'param_publisher')) await this.access.assertOrgManager(user, pack.scope_ref);
    else if (pack.level !== 'org' && !hasPlatformRole(user, 'param_publisher')) throw Errors.forbidden('Rôle param_publisher requis');
    const repo = this.ds.getRepository(ParamPackVersion);
    const target = await repo.findOne({ where: { pack_id: pack.id, version: body.to_version } });
    if (!target || !target.signature || !['retire', 'publie'].includes(target.status)) {
      throw Errors.business('RG-PAR-06', 'Seule une version déjà publiée peut être rétablie', { to_version: body.to_version });
    }
    await this.ds.transaction(async (m) => {
      await m.getRepository(ParamPackVersion).update({ pack_id: pack.id, status: In(['publie']) }, { status: 'retire', retired_at: new Date() });
      target.status = 'publie';
      target.retired_at = null;
      target.rollout = null;
      target.published_at = new Date();
      target.published_by = user.id;
      await m.getRepository(ParamPackVersion).save(target);
      await m.getRepository(ParamPublication).save({ version_id: target.id, action: 'rollback', actor_id: user.id, reason: body.reason });
    });
    this.params.invalidate();
    return this.serialize(target, pack);
  }

  async diff(_user: AuthUser, id: string) {
    const { v, pack } = await this.version(id);
    const published = await this.ds.getRepository(ParamPackVersion).findOne({ where: { pack_id: pack.id, status: 'publie' }, order: { published_at: 'DESC' } });
    const raw = diffPacks((published?.content as unknown as PackDoc) ?? null, v.content as unknown as PackDoc);
    const major = raw.some((c) => c.op === '-' || (c.op === '~' && /offset_days|every_days|reference/.test(c.path)));
    const changes = raw.map((c) => ({ op: c.op === '+' ? 'add' : c.op === '-' ? 'remove' : 'change', path: c.path, before: c.from, after: c.to }));
    // Impact: subjects whose reminders are recomputed when a vaccination protocol changes.
    const protocols = [...new Set(raw.filter((c) => c.path.startsWith('vaccination_protocol:')).map((c) => c.path.split(':')[1].split('.')[0]))];
    let subjects = 0;
    const content = v.content as unknown as PackDoc;
    for (const code of protocols) {
      const p = content.objects.find((o) => o.kind === 'vaccination_protocol' && o.code === code) as { species?: string; production_type?: string } | undefined;
      if (p?.species === 'chien') subjects += Number((await this.ds.query(`SELECT count(*)::int AS n FROM dogs WHERE deleted_at IS NULL`))[0].n);
      else if (p?.species) {
        subjects += Number(
          (await this.ds.query(`SELECT count(*)::int AS n FROM batches WHERE deleted_at IS NULL AND status = 'en_cours' AND species = $1 AND ($2::text IS NULL OR production_type = $2)`, [p.species, p.production_type ?? null]))[0].n,
        );
      }
    }
    return {
      base_version: published?.version ?? null,
      from_version: published?.version ?? null,
      to_version: v.version,
      changes,
      major,
      major_change: major,
      impact: { subjects_recomputed: subjects, protocols },
      generated_on: todayIn(),
    };
  }
}
