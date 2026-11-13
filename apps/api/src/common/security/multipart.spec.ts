/**
 * Televersements multipart : limites de multer 2.5 activees (CVE-2026-82333, CVE-2026-5079, CVE-2026-77078).
 * Ces limites sont OPT-IN dans multer : sans elles, un seul champ `b[999999999]=1` fabrique un tableau creux
 * d'un milliard de cases que la validation parcourt ensuite (CPU a 100 % pendant plus d'une minute, mesure sur
 * l'image le 2026-11-12). Voir docs/security/cve-image-api.md.
 */
import { Body, Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../error.filter';
import { SAFE_MULTIPART_LIMITS, SafeFileInterceptor, toMultipartError } from './multipart';

@Controller()
class UploadController {
  @Post('upload')
  @UseInterceptors(SafeFileInterceptor('file', 1024))
  upload(@Body() body: Record<string, unknown>, @UploadedFile() file?: { buffer: Buffer }) {
    return { fields: Object.keys(body), size: file?.buffer.length ?? 0 };
  }
}

describe('SafeFileInterceptor (limites multipart)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [UploadController] }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('accepte un formulaire plat avec un fichier', async () => {
    const res = await http().post('/upload').field('kind', 'farmers').attach('file', Buffer.from('a,b\n1,2\n'), 'f.csv').expect(201);
    expect(res.body).toEqual({ fields: ['kind'], size: 8 });
  });

  it('refuse en 422 un indice de tableau geant dans un nom de champ (CVE-2026-82333)', async () => {
    const started = Date.now();
    const res = await http().post('/upload').field('b[999999999]', '1').attach('file', Buffer.from('x'), 'f.csv').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuse en 422 un nom de champ imbrique (CVE-2026-5079, CVE-2026-77078)', async () => {
    const res = await http().post('/upload').field('a[b][c]', '1').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuse en 422 un trop grand nombre de champs', async () => {
    let req = http().post('/upload');
    expect(SAFE_MULTIPART_LIMITS.fields).toBeGreaterThan(0);
    for (let i = 0; i <= (SAFE_MULTIPART_LIMITS.fields ?? 0); i++) req = req.field(`f${i}`, 'x');
    await req.expect(422);
  });

  it('refuse en 413 un fichier trop gros', async () => {
    await http().post('/upload').attach('file', Buffer.alloc(2048, 1), 'f.csv').expect(413);
  });

  it('refuse en 422 un second fichier', async () => {
    await http().post('/upload').attach('file', Buffer.from('x'), 'a.csv').attach('file', Buffer.from('y'), 'b.csv').expect(422);
  });

  it('laisse passer les erreurs qui ne viennent pas de multer', () => {
    const e = new Error('autre');
    expect(toMultipartError(e)).toBe(e);
    expect(toMultipartError('texte')).toBe('texte');
  });
});
