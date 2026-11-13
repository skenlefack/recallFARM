import * as XLSX from 'xlsx';
import { crc32, deflateRawSync } from 'zlib';
import { XLSX_MAX_COLUMNS, XLSX_MAX_ROWS, XLSX_MAX_UNCOMPRESSED, boundedSheetRange, sanitizeXlsx } from './xlsx-guard';

/** Entry of SheetJS's CFB container (not exported by its type definitions). */
type CfbEntry = { type: number; content: Uint8Array | number[] };

/** Real workbook built by SheetJS itself (stored, or deflated with compression: true). */
function workbook(rows: string[][], compression = false): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Eleveurs');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression }) as Buffer;
}

type Spec = {
  name: string;
  content: Buffer;
  deflate?: boolean;
  flags?: number;
  /** Overrides of what the headers declare (the content stays what it is). */
  localCsz?: number;
  localUsz?: number;
  centralUsz?: number;
  localExtra?: Buffer;
};

/** Hand-made zip, to forge the archives of the security review (Q-SEC-01). */
function zip(specs: Spec[], opts: { comment?: Buffer; entriesOnDisk?: number; reverseCentral?: boolean; prefix?: Buffer } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = opts.prefix?.length ?? 0;
  for (const s of specs) {
    const data = s.deflate ? deflateRawSync(s.content) : s.content;
    const method = s.deflate ? 8 : 0;
    const name = Buffer.from(s.name);
    const extra = s.localExtra ?? Buffer.alloc(0);
    const crc = crc32(s.content);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(s.flags ?? 0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(s.localCsz ?? data.length, 18);
    lh.writeUInt32LE(s.localUsz ?? s.content.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(s.flags ?? 0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(s.centralUsz ?? s.content.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    parts.push(lh, name, extra, data);
    central.push(ch, name);
    offset += 30 + name.length + extra.length + data.length;
  }
  const pairs: Buffer[][] = [];
  for (let i = 0; i < central.length; i += 2) pairs.push([central[i], central[i + 1]]);
  if (opts.reverseCentral) pairs.reverse();
  const cd = Buffer.concat(pairs.flat());
  const comment = opts.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.entriesOnDisk ?? specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([opts.prefix ?? Buffer.alloc(0), ...parts, cd, eocd, comment]);
}

/** Entries of a SheetJS workbook, re-packed by the forger above. */
function entriesOf(buf: Buffer): Spec[] {
  const z = XLSX.CFB.read(buf, { type: 'buffer' });
  return z.FullPaths.map((path: string, i: number) => ({ path, e: z.FileIndex[i] }))
    .filter(({ e }: { e: CfbEntry }) => e.type === 2)
    .map(({ path, e }: { path: string; e: CfbEntry }) => ({ name: path.replace(/^Root Entry\//, ''), content: Buffer.from(e.content) }));
}

const rowsOf = (buf: Buffer) => {
  const wb = XLSX.read(sanitizeXlsx(buf), { type: 'buffer', cellHTML: false });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
};

const ROWS = [['phone', 'name'], ['+237690000001', 'Awa']];
const ZEROS = Buffer.alloc(64 * 1024 * 1024); // 64 MB, deflates to ~64 KB

describe('sanitizeXlsx (Q-SEC-01, ADR-006)', () => {
  it('accepts ordinary workbooks, stored or deflated, and keeps their content', () => {
    expect(rowsOf(workbook(ROWS))).toEqual(ROWS);
    expect(rowsOf(workbook(ROWS, true))).toEqual(ROWS);
    expect(XLSX_MAX_UNCOMPRESSED).toBe(16 * 1024 * 1024);
  });

  it('hands SheetJS an uncompressed copy (nothing left to inflate)', () => {
    const safe = sanitizeXlsx(workbook(ROWS, true));
    const z = XLSX.CFB.read(safe, { type: 'buffer' });
    expect(z.FileIndex.filter((e: CfbEntry) => e.type === 2).length).toBeGreaterThan(3);
    // Every central header of the copy says "stored" (method 0).
    for (let i = safe.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = safe.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
      expect(safe.readUInt16LE(i + 10)).toBe(0);
    }
  });

  it('accepts data-descriptor archives (sizes only in the central directory)', () => {
    const specs = entriesOf(workbook(ROWS)).map((s) => ({ ...s, deflate: true, flags: 0x0008, localCsz: 0, localUsz: 0 }));
    expect(rowsOf(zip(specs))).toEqual(ROWS);
  });

  it('accepts a central directory in another order than the entries (as Excel writes it)', () => {
    const specs = entriesOf(workbook(ROWS)).map((s) => ({ ...s, deflate: true }));
    expect(rowsOf(zip(specs, { reverseCentral: true }))).toEqual(ROWS);
  });

  it('refuses data hidden before the first entry', () => {
    const specs = entriesOf(workbook(ROWS));
    const z = zip(specs, { prefix: Buffer.from('PK' + 'x'.repeat(60)) });
    expect(() => sanitizeXlsx(z)).toThrow('classeur Excel invalide');
  });

  it('review B1: a zero declared size cannot expand (2 GB bomb in 2 MB)', () => {
    const bomb = zip([{ name: 'xl/sharedStrings.xml', content: ZEROS, deflate: true, localUsz: 0, centralUsz: 0 }]);
    expect(() => sanitizeXlsx(bomb)).toThrow('taille déclarée fausse');
  });

  it('review B1: a small declared size that lies is caught by the capped inflate', () => {
    const bomb = zip([{ name: 'xl/sharedStrings.xml', content: ZEROS, deflate: true, localUsz: 100, centralUsz: 100 }]);
    expect(() => sanitizeXlsx(bomb)).toThrow('taille déclarée fausse');
  });

  it('refuses an honest archive above the limit', () => {
    const big = zip([{ name: 'xl/sharedStrings.xml', content: ZEROS, deflate: true }]);
    expect(() => sanitizeXlsx(big)).toThrow('trop volumineux une fois décompressé (16 Mo maximum)');
    expect(() => sanitizeXlsx(workbook(ROWS), 100)).toThrow('trop volumineux');
  });

  it('refuses local and central headers that disagree', () => {
    const specs = entriesOf(workbook(ROWS));
    specs[0] = { ...specs[0], localUsz: specs[0].content.length + 1 };
    expect(() => sanitizeXlsx(zip(specs))).toThrow('classeur Excel invalide');
  });

  it('review M1: a second end-of-directory record (fake one in the comment) is refused', () => {
    const fake = Buffer.alloc(22);
    fake.writeUInt32LE(0x06054b50, 0);
    expect(() => sanitizeXlsx(zip(entriesOf(workbook(ROWS)), { comment: fake }))).toThrow('classeur Excel invalide');
  });

  it('review M1: inconsistent entry counts are refused', () => {
    const specs = entriesOf(workbook(ROWS));
    expect(() => sanitizeXlsx(zip(specs, { entriesOnDisk: specs.length + 1 }))).toThrow('classeur Excel invalide');
  });

  it('review M2: only a plain zip is parsed (CSV, OLE/xls, HTML refused)', () => {
    expect(() => sanitizeXlsx(Buffer.from('phone,name\n+237690000001,Awa\n'))).toThrow('classeur Excel invalide');
    const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), workbook(ROWS)]);
    expect(() => sanitizeXlsx(ole)).toThrow('classeur Excel invalide');
    expect(() => sanitizeXlsx(Buffer.from('<html><table><tr><td>x</td></tr></table></html>'))).toThrow('classeur Excel invalide');
  });

  it('refuses zip64 markers', () => {
    const extra = Buffer.alloc(20);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(16, 2);
    const specs = entriesOf(workbook(ROWS));
    specs[0] = { ...specs[0], localExtra: extra };
    expect(() => sanitizeXlsx(zip(specs))).toThrow('zip64');
  });

  it('turns any malformed or truncated archive into the same user-facing error', () => {
    const ok = workbook(ROWS, true);
    for (const cut of [10, 100, Math.floor(ok.length / 2), ok.length - 30]) {
      expect(() => sanitizeXlsx(ok.subarray(0, cut))).toThrow('classeur Excel invalide');
    }
    const corrupted = Buffer.from(ok);
    corrupted.fill(0xff, 60, 400);
    expect(() => sanitizeXlsx(corrupted)).toThrow(/classeur Excel invalide/);
  });

  it('review 0e1d1ae B1: entries sharing or overlapping their bytes are refused (no repeated inflate)', () => {
    const one = zip([{ name: 'xl/a.xml', content: Buffer.from('<a/>'), deflate: true }]);
    // Same archive, plus a second central entry pointing at the same local header.
    const eocdAt = one.length - 22;
    const cdOffset = one.readUInt32LE(eocdAt + 16);
    const cdEntry = one.subarray(cdOffset, eocdAt);
    const dup = Buffer.from(cdEntry);
    dup.write('xl/b.xml', 46, 'latin1');
    const eocd = Buffer.from(one.subarray(eocdAt));
    eocd.writeUInt16LE(2, 8);
    eocd.writeUInt16LE(2, 10);
    eocd.writeUInt32LE(cdEntry.length * 2, 12);
    const shared = Buffer.concat([one.subarray(0, eocdAt), dup, eocd]);
    expect(() => sanitizeXlsx(shared)).toThrow('entrées qui se chevauchent');
  });

  it('refuses duplicate entry names', () => {
    const specs = entriesOf(workbook(ROWS));
    expect(() => sanitizeXlsx(zip([...specs, { ...specs[0] }]))).toThrow('classeur Excel invalide');
    expect(() => sanitizeXlsx(zip([...specs, { ...specs[0], name: specs[0].name.toUpperCase() }]))).toThrow('classeur Excel invalide');
  });

  it('refuses more entries than a real workbook has', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `x/${i}.xml`, content: Buffer.from('<a/>') }));
    expect(() => sanitizeXlsx(zip(many))).toThrow('trop complexe');
  });
});

describe('boundedSheetRange (review 0e1d1ae B2: never trust <dimension>)', () => {
  it('keeps an ordinary range', () => {
    expect(boundedSheetRange('A1:E3')).toEqual({ s: { r: 0, c: 0 }, e: { r: 2, c: 4 } });
    expect(boundedSheetRange(undefined)).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } });
  });

  it('caps the rows at header + max rows + 1 and refuses too many columns', () => {
    expect(boundedSheetRange('A1:E9999999').e.r).toBe(XLSX_MAX_ROWS + 1);
    expect(() => boundedSheetRange('A1:XFD20001')).toThrow(`trop de colonnes (${XLSX_MAX_COLUMNS} maximum)`);
    expect(() => boundedSheetRange('B2:A1')).toThrow('classeur Excel invalide');
    expect(() => boundedSheetRange('not a ref')).toThrow('classeur Excel invalide');
  });

  it('a tiny workbook announcing a huge sheet is refused before any cell is filled', () => {
    // Patch only the <dimension> of a real 2-row sheet (writing such a sheet with SheetJS would
    // itself try to emit every announced cell).
    const specs = entriesOf(workbook(ROWS)).map((e) =>
      /worksheets\/sheet1\.xml$/.test(e.name)
        ? { ...e, content: Buffer.from(e.content.toString('utf8').replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:XFD20001"/>')) }
        : e,
    );
    expect(specs.some((e) => e.content.includes('A1:XFD20001'))).toBe(true);
    const file = zip(specs.map((e) => ({ ...e, deflate: true })));
    expect(file.length).toBeLessThan(20_000);
    const read = XLSX.read(sanitizeXlsx(file), { type: 'buffer', sheetRows: XLSX_MAX_ROWS + 2, cellHTML: false });
    expect(() => boundedSheetRange(read.Sheets[read.SheetNames[0]]['!ref'])).toThrow('trop de colonnes');
  });
});
