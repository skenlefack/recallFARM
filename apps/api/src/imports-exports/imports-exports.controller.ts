import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { parse } from 'csv-parse/sync';
import { createHash, randomUUID } from 'crypto';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser } from '../common/auth';
import { SafeFileInterceptor } from '../common/security/multipart';
import { addDays, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { E164, normalisePhone, toCsv } from '../common/text';
import { config } from '../config';
import { ExportJob, Farm, ImportJob, Membership, User } from '../database/entities';
import { filierePackFor } from '../params/engine/resolution';
import { XLSX_MAX_ROWS, sanitizeXlsx } from './xlsx-guard';

export class ImportDto {
  @ApiProperty({ enum: ['farmers'] }) @IsIn(['farmers']) kind: 'farmers';
  @ApiProperty() @IsUUID() organisation_id: string;
  @ApiPropertyOptional({ description: 'CSV text (alternative to the multipart `file` field)' }) @IsOptional() @IsString() @MaxLength(5_000_000) csv?: string;
}

export class ExportDto {
  @ApiProperty({ enum: ['csv'] }) @IsIn(['csv']) kind: 'csv';
  @ApiProperty({ enum: ['reminders', 'farms', 'health_events'] }) @IsIn(['reminders', 'farms', 'health_events']) scope: 'reminders' | 'farms' | 'health_events';
  @ApiPropertyOptional({ example: '30d', description: '7d | 30d | 90d | YYYY-MM' }) @IsOptional() @Matches(/^(\d{1,3}d|\d{4}-\d{2})$/) period?: string;
  @ApiPropertyOptional({ description: 'Export for an organisation (managers) instead of your own farms' }) @IsOptional() @IsUUID() organisation_id?: string;
}

const REQUIRED_COLUMNS = ['phone', 'name', 'farm_name', 'region', 'speculations'];

@ApiTags('imports-exports')
@ApiBearerAuth()
@Controller()
export class ImportsExportsController {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
  ) {}

  /** POST /imports — CSV of farmers (phone,name,farm_name,region,speculations); validated, then committed separately. */
  @Post('imports')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(SafeFileInterceptor('file', 5 * 1024 * 1024))
  async create(@CurrentUser() user: AuthUser, @Body() dto: ImportDto, @UploadedFile() file?: { buffer: Buffer }) {
    await this.access.assertOrgManager(user, dto.organisation_id);
    const text = file?.buffer?.toString('utf8') ?? dto.csv;
    const isXlsx = file?.buffer && (file as any).originalname?.endsWith('.xlsx');
    if (!text && !isXlsx) throw Errors.validation({ file: 'fichier CSV ou XLSX requis (champ file ou csv)' });
    let records: Array<Record<string, string>>;
    try {
      if (isXlsx) {
        // Never parse the upload itself: a verified, uncompressed copy (xlsx-guard.ts).
        const safe = sanitizeXlsx(file!.buffer);
        // Header + max rows + 1 extra row to detect a file that is too long.
        const wb = XLSX.read(safe, { type: 'buffer', sheetRows: XLSX_MAX_ROWS + 2, cellHTML: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) throw new Error('fichier vide');
        if (raw.length > XLSX_MAX_ROWS + 1) throw new Error(`trop de lignes (${XLSX_MAX_ROWS} maximum par import)`);
        const header = raw[0].map((h) => String(h).trim().toLowerCase());
        records = raw.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
          const obj: Record<string, string> = {};
          header.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });
          return obj;
        });
      } else {
        records = parse(text!.replace(/^\uFEFF/, ''), { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, delimiter: [',', ';'] });
      }
    } catch (e) {
      throw Errors.validation({ file: `fichier illisible : ${(e as Error).message}` });
    }
    const header = records.length ? Object.keys(records[0]) : [];
    const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (records.length && missing.length) throw Errors.validation({ file: `colonnes manquantes : ${missing.join(', ')}` });
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    records.forEach((r, i) => {
      const row = i + 2; // header is line 1
      const phone = normalisePhone(r.phone ?? '');
      const specs = (r.speculations ?? '').split(/[|;/ ]+/).map((s) => s.trim()).filter(Boolean);
      const before = errors.length;
      if (!E164.test(phone)) errors.push({ row, field: 'phone', message: 'format E.164 attendu' });
      else if (seen.has(phone)) errors.push({ row, field: 'phone', message: 'doublon dans le fichier' });
      if (!r.name) errors.push({ row, field: 'name', message: 'obligatoire' });
      if (!r.farm_name) errors.push({ row, field: 'farm_name', message: 'obligatoire' });
      if (!specs.length) errors.push({ row, field: 'speculations', message: 'obligatoire' });
      else if (specs.some((s) => !filierePackFor(s))) errors.push({ row, field: 'speculations', message: 'spéculation inconnue' });
      if (errors.length === before) {
        seen.add(phone);
        rows.push({ row, phone, name: r.name, farm_name: r.farm_name, region: r.region || null, locality: r.locality || null, speculations: specs });
      }
    });
    const repo = this.ds.getRepository(ImportJob);
    const job = await repo.save(
      repo.create({ kind: 'farmers', organisation_id: dto.organisation_id, status: 'valide', rows_total: records.length, rows_ok: rows.length, rows, errors, created_by: user.id }),
    );
    return { job_id: job.id, rows_total: records.length, total_rows: records.length, valid_rows: rows.length, errors, preview: rows.slice(0, 20) };
  }

  @Post('imports/:id/commit')
  @HttpCode(200)
  async commit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.ds.getRepository(ImportJob).findOne({ where: { id } });
    if (!job) throw Errors.notFound('Import');
    await this.access.assertOrgManager(user, job.organisation_id!);
    if (job.status === 'importe') return { job_id: job.id, status: job.status, created: 0, updated: 0, skipped: job.rows.length, created_farms: 0, already_committed: true };
    let created = 0;
    let linked = 0;
    let skipped = 0;
    let updated = 0;
    await this.ds.transaction(async (m) => {
      for (const r of job.rows) {
        const users = m.getRepository(User);
        let u = await users.findOne({ where: { phone: r.phone } });
        if (!u) u = await users.save(users.create({ phone: r.phone, full_name: r.name, account_status: 'provisoire', has_smartphone: false }));
        const mem = await m.getRepository(Membership).findOne({ where: { user_id: u.id, organisation_id: job.organisation_id! } });
        if (!mem) {
          await m.getRepository(Membership).save({ user_id: u.id, organisation_id: job.organisation_id!, role: 'membre', status: 'actif' });
          linked++;
        } else updated++;
        const exists = await m.getRepository(Farm).findOne({ where: { owner_id: u.id, name: r.farm_name } });
        if (!exists) {
          await m.getRepository(Farm).save(
            m.getRepository(Farm).create({
              id: randomUUID(), owner_id: u.id, organisation_id: job.organisation_id, name: r.farm_name, speculations: r.speculations,
              country: 'CM', region: r.region, locality: r.locality, currency: 'XAF', created_by: user.id,
            }),
          );
          created++;
        } else skipped++;
      }
      job.status = 'importe';
      job.committed_at = new Date();
      await m.getRepository(ImportJob).save(job);
    });
    return { job_id: job.id, status: job.status, created, updated: Math.min(updated, job.rows.length - created), skipped, created_farms: created, new_members: linked };
  }

  /** POST /imports/:id/cancel — cancel a committed import within 24 hours. */
  @Post('imports/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.ds.getRepository(ImportJob).findOne({ where: { id } });
    if (!job) throw Errors.notFound('Import');
    await this.access.assertOrgManager(user, job.organisation_id!);
    if (job.status !== 'importe') throw Errors.validation({ status: 'import non encore commite ou deja annule' });
    const committedAt = job.committed_at ?? job.created_at;
    const hoursElapsed = (Date.now() - new Date(committedAt).getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > 24) throw Errors.validation({ status: 'annulation impossible apres 24 heures' });

    await this.ds.transaction(async (m) => {
      // Soft-delete farms and memberships created by this import
      for (const r of job.rows) {
        const u = await m.getRepository(User).findOne({ where: { phone: r.phone } });
        if (!u) continue;
        // Remove membership from this org
        await m.getRepository(Membership).softDelete({ user_id: u.id, organisation_id: job.organisation_id! });
        // Soft-delete farms created by this import (same owner + name + org)
        await m.getRepository(Farm).softDelete({ owner_id: u.id, name: r.farm_name, organisation_id: job.organisation_id! });
        // If user was created as provisoire and has no other farms, soft-delete
        const farmCount = await m.getRepository(Farm).count({ where: { owner_id: u.id } });
        if (farmCount === 0 && u.account_status === 'provisoire') {
          await m.getRepository(User).softDelete({ id: u.id });
        }
      }
      job.status = 'annule';
      await m.getRepository(ImportJob).save(job);
    });
    return { job_id: job.id, status: 'annule', message: 'Import annule avec succes' };
  }

  /** POST /exports — returns the CSV file directly (also archived under EXPORTS_DIR). */
  @Post('exports')
  @HttpCode(200)
  async export(@CurrentUser() user: AuthUser, @Body() dto: ExportDto, @Res() res: Response) {
    let farmIds: string[];
    if (dto.organisation_id) {
      await this.access.assertOrgManager(user, dto.organisation_id);
      farmIds = (await this.ds.query(`SELECT id FROM farms WHERE organisation_id = $1 AND deleted_at IS NULL`, [dto.organisation_id])).map((r: { id: string }) => r.id);
    } else farmIds = await this.access.farmIds(user);
    const today = todayIn();
    const period = dto.period ?? '30d';
    const [from, to] = /^\d{4}-\d{2}$/.test(period)
      ? [`${period}-01`, addDays(addDays(`${period}-01`, 32).slice(0, 7) + '-01', -1)]
      : [addDays(today, -Number(period.replace('d', ''))), addDays(today, 60)];
    let headers: string[];
    let rows: Array<Record<string, unknown>>;
    if (dto.scope === 'farms') {
      headers = ['id', 'name', 'owner_name', 'locality', 'region', 'country', 'speculations', 'gps_lat', 'gps_lng', 'created_at'];
      rows = await this.ds.query(
        `SELECT f.id, f.name, u.full_name AS owner_name, f.locality, f.region, f.country, array_to_string(f.speculations, '|') AS speculations, f.gps_lat, f.gps_lng, f.created_at
           FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ANY($1) ORDER BY f.name`,
        [farmIds],
      );
    } else if (dto.scope === 'reminders') {
      headers = ['id', 'farm', 'subject', 'disease', 'step', 'due_date', 'status', 'priority', 'confirmed_at', 'confirmed_via'];
      rows = await this.ds.query(
        `SELECT r.id, f.name AS farm, r.subject_ref AS subject, r.disease, r.step, r.due_date::text AS due_date, r.status, r.priority, r.confirmed_at, r.confirmed_via
           FROM reminders r JOIN farms f ON f.id = r.farm_id
          WHERE r.farm_id = ANY($1) AND r.deleted_at IS NULL AND r.due_date BETWEEN $2 AND $3 ORDER BY r.due_date`,
        [farmIds, from, to],
      );
    } else {
      headers = ['id', 'farm', 'subject_type', 'subject_id', 'event_type', 'disease', 'product', 'product_batch_no', 'event_date', 'protocol_step', 'performed_by'];
      rows = await this.ds.query(
        `SELECT h.id, f.name AS farm, h.subject_type, h.subject_id, h.event_type, h.disease, h.product, h.product_batch_no, h.event_date::text AS event_date, h.protocol_step, h.performed_by
           FROM health_events h JOIN farms f ON f.id = h.farm_id
          WHERE h.farm_id = ANY($1) AND h.deleted_at IS NULL AND h.event_date BETWEEN $2 AND $3 ORDER BY h.event_date`,
        [farmIds, from, to],
      );
    }
    const csv = toCsv(headers, rows);
    const job = await this.ds.getRepository(ExportJob).save({ kind: 'csv', requested_by: user.id, scope: { ...dto, from, to }, status: 'pret', rows: rows.length });
    const dir = join(config().exportsDir, 'csv');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${dto.scope}-${job.id}.csv`);
    writeFileSync(file, csv);
    await this.ds.getRepository(ExportJob).update({ id: job.id }, { file_uri: `file://${file}`, file_hash: createHash('sha256').update(csv).digest('hex'), completed_at: new Date() });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="recallfarm-${dto.scope}-${today}.csv"`);
    res.setHeader('x-export-job-id', job.id);
    res.send(csv);
  }
}
