import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { DataSource } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { addDays, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { b64url, KeysService } from '../common/keys.service';
import { config } from '../config';
import { Farm, HealthEvent } from '../database/entities';
import { ParamsService } from '../params/params.service';
import { SubjectsService } from './subjects.service';

interface CertPayload {
  v: 1;
  id: string;
  animal_name: string;
  species: string;
  disease: string | null;
  disease_label: string;
  event_date: string;
  valid_until: string;
  chip_number?: string | null;
  iss: 'recallfarm';
}

/** Vaccination certificate (⭐ Pro): PDF + QR payload = base64url(json) + "." + Ed25519 signature. */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly subjects: SubjectsService,
    private readonly params: ParamsService,
    private readonly keys: KeysService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async load(user: AuthUser, id: string) {
    const ev = await this.ds.getRepository(HealthEvent).findOne({ where: { id } });
    if (!ev) throw Errors.notFound('Acte');
    const farm = await this.access.farm(user, ev.farm_id);
    await this.entitlements.assertFeature(await this.entitlements.forFarm(farm), 'certificat_qr');
    const subject = await this.subjects.load(ev.subject_type, ev.subject_id, { withDeleted: true });
    const resolved = await this.params.resolveFarm(farm);
    let validUntil = ev.next_due ?? addDays(ev.event_date, 365);
    for (const p of this.params.protocols(resolved, subject.species, subject.production_type)) {
      if (p.recurring && p.recurring.disease === ev.disease) validUntil = addDays(ev.event_date, p.recurring.every_days);
    }
    const payload: CertPayload = {
      v: 1,
      id: ev.id,
      animal_name: subject.label,
      species: subject.species,
      disease: ev.disease,
      disease_label: this.params.label(resolved, ev.disease),
      event_date: ev.event_date,
      valid_until: validUntil,
      chip_number: (subject.entity as { chip_number?: string | null }).chip_number ?? null,
      iss: 'recallfarm',
    };
    return { ev, farm, subject, payload };
  }

  sign(payload: CertPayload): string {
    const body = b64url(JSON.stringify(payload));
    return `${body}.${this.keys.sign(body)}`;
  }

  async json(user: AuthUser, id: string) {
    const { payload } = await this.load(user, id);
    const qr = this.sign(payload);
    return { qr_payload: qr, valid_until: payload.valid_until, verify_url: `${config().publicVerifyUrl}?payload=${encodeURIComponent(qr)}` };
  }

  verify(qr: string) {
    const invalid = (reason: string) => ({ valid: false, reason, animal_name: null, species: null, disease: null, event_date: null, valid_until: null, expired: null });
    const parts = (qr ?? '').trim().split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
      throw Errors.validation({ payload: 'format attendu : base64url(json).signature' });
    }
    if (!this.keys.verify(parts[0], parts[1])) return invalid('signature_invalide');
    try {
      const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as CertPayload;
      return {
        valid: true,
        animal_name: p.animal_name,
        species: p.species,
        disease: p.disease_label || p.disease,
        disease_code: p.disease,
        event_date: p.event_date,
        valid_until: p.valid_until,
        expired: p.valid_until < todayIn(),
      };
    } catch {
      return invalid('contenu_illisible');
    }
  }

  async pdf(user: AuthUser, id: string): Promise<Buffer> {
    const { ev, farm, payload } = await this.load(user, id);
    const qr = this.sign(payload);
    const url = `${config().publicVerifyUrl}?payload=${encodeURIComponent(qr)}`;
    const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    return renderPdf(farm, ev, payload, png);
  }
}

function renderPdf(farm: Farm, ev: HealthEvent, p: CertPayload, qrPng: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Certificat ${p.disease_label} — ${p.animal_name}`, Author: 'RecallFarm' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fillColor('#1d4ed8').fontSize(18).text('RecallFarm', { continued: false });
    doc.fillColor('#111827').fontSize(14).text('Certificat de vaccination', { underline: false });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#374151');
    const line = (k: string, v: string | null | undefined) => doc.font('Helvetica-Bold').text(`${k} : `, { continued: true }).font('Helvetica').text(v ?? '—');
    line('Sujet', p.animal_name);
    line('Espèce', p.species);
    if (p.chip_number) line('Puce', p.chip_number);
    line('Maladie', p.disease_label);
    line('Date de l’acte', p.event_date);
    line('Produit / lot', [ev.product, ev.product_batch_no].filter(Boolean).join(' · ') || null);
    line('Réalisé par', ev.performed_by);
    line('Valide jusqu’au', p.valid_until);
    line('Exploitation', `${farm.name} (${farm.country})`);
    doc.moveDown(0.5);
    doc.image(qrPng, { fit: [150, 150] });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#6b7280').text('Scannez le QR code pour vérifier l’authenticité (signature Ed25519). Aucune donnée personnelle du propriétaire n’est incluse.');
    doc.end();
  });
}
