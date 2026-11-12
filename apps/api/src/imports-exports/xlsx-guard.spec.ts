import * as XLSX from 'xlsx';
import { XLSX_MAX_UNCOMPRESSED, assertXlsxArchiveSafe } from './xlsx-guard';

/** Real workbook built by SheetJS itself. */
function workbook(rows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Eleveurs');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Offset of the first central directory header. */
function firstCentralHeader(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) return buf.readUInt32LE(i + 16);
  throw new Error('no EOCD');
}

describe('assertXlsxArchiveSafe (Q-SEC-01, zip bomb)', () => {
  const ok = workbook([['phone', 'name'], ['+237690000001', 'Awa']]);

  it('accepts an ordinary workbook', () => {
    expect(() => assertXlsxArchiveSafe(ok)).not.toThrow();
    expect(XLSX_MAX_UNCOMPRESSED).toBe(40 * 1024 * 1024);
  });

  it('refuses an archive whose declared uncompressed size exceeds the limit', () => {
    const bomb = Buffer.from(ok);
    bomb.writeUInt32LE(50 * 1024 * 1024, firstCentralHeader(bomb) + 24);
    expect(() => assertXlsxArchiveSafe(bomb)).toThrow('trop volumineux une fois décompressé (40 Mo maximum)');
    expect(() => assertXlsxArchiveSafe(ok, 100)).toThrow('trop volumineux');
  });

  it('refuses zip64 markers', () => {
    const z64 = Buffer.from(ok);
    z64.writeUInt32LE(0xffffffff, firstCentralHeader(z64) + 24);
    expect(() => assertXlsxArchiveSafe(z64)).toThrow('zip64');
  });

  it('refuses something that is not a zip, or a corrupted central directory', () => {
    expect(() => assertXlsxArchiveSafe(Buffer.from('phone,name\n+237690000001,Awa\n'))).toThrow('classeur Excel invalide');
    const broken = Buffer.from(ok);
    broken.writeUInt32LE(0, firstCentralHeader(broken));
    expect(() => assertXlsxArchiveSafe(broken)).toThrow('classeur Excel invalide');
  });
});
