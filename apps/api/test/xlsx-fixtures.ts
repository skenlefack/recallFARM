import * as XLSX from 'xlsx';
import { crc32, deflateRawSync } from 'zlib';

/** Entries of a workbook written by SheetJS (stored), to re-pack them by hand. */
export function workbookEntries(rows: string[][]): Array<{ name: string; content: Buffer }> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Eleveurs');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const z = XLSX.CFB.read(buf, { type: 'buffer' }) as unknown as { FullPaths: string[]; FileIndex: Array<{ type: number; content: Uint8Array }> };
  return z.FullPaths.map((path, i) => ({ path, e: z.FileIndex[i] }))
    .filter(({ e }) => e.type === 2)
    .map(({ path, e }) => ({ name: path.replace(/^Root Entry\//, ''), content: Buffer.from(e.content) }));
}

/** Minimal deflated zip; `sharedLocal` makes every central entry point at the first local header. */
export function deflatedZip(entries: Array<{ name: string; content: Buffer }>, opts: { sharedLocal?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const data = deflateRawSync(e.content);
    const name = Buffer.from(e.name);
    const crc = crc32(e.content);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(e.content.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(e.content.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(opts.sharedLocal ? 0 : offset, 42);
    if (!opts.sharedLocal || i === 0) {
      parts.push(lh, name, data);
      offset += 30 + name.length + data.length;
    } else {
      // Same bytes as the first entry: sizes and name must match it to look legitimate.
      const first = central[0];
      first.copy(ch, 16, 16, 28);
    }
    central.push(ch, name);
  });
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
