import { crc32, inflateRawSync } from 'zlib';

/**
 * Guard run before XLSX.read (Q-SEC-01, ADR-006). An .xlsx is a zip: the 5 MB upload limit
 * only bounds the compressed size, and SheetJS inflates every entry up front with its own
 * pure-JS inflate, trusting the sizes declared in the LOCAL headers (a lying or zero size lets
 * a 2 MB file expand to gigabytes). So we never hand SheetJS the uploaded archive:
 * - only a plain zip starting with a local header is accepted (no OLE/HTML/SYLK fallbacks);
 * - the end-of-central-directory record is found exactly as SheetJS does, must be unique,
 *   single-disk, with consistent counts;
 * - every entry is inflated HERE with native zlib under a hard output cap, and its real size
 *   must equal the central-directory size;
 * - the verified contents are rewritten as a new STORED (uncompressed) zip, so SheetJS has
 *   nothing left to inflate and only sees true, bounded sizes.
 * Data-descriptor archives (sizes only in the central directory, written by many tools) are
 * therefore supported safely.
 */

/** Max total uncompressed size of an imported workbook (about 3x a 20 000-row import). */
export const XLSX_MAX_UNCOMPRESSED = 16 * 1024 * 1024;
/** Max data rows (header excluded) of an imported workbook. */
export const XLSX_MAX_ROWS = 20_000;
const MAX_ENTRIES = 2_000;

const LFH_SIG = 0x04034b50;
const CDH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EXTRA = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

/** Marker of a deliberate refusal (no class: `instanceof Error` subclasses breaks on ES5 targets). */
const REJECTED = Symbol('xlsx-rejected');

const INVALID = 'classeur Excel invalide';
const BAD_SIZE = 'classeur Excel invalide (taille déclarée fausse ou données corrompues)';
const ZIP64 = 'classeur Excel non pris en charge (zip64)';

function reject(message = INVALID): never {
  throw Object.assign(new Error(message), { [REJECTED]: true });
}

function hasZip64Extra(buf: Buffer, start: number, len: number): boolean {
  let p = start;
  const end = start + len;
  while (p + 4 <= end) {
    if (buf.readUInt16LE(p) === ZIP64_EXTRA) return true;
    p += 4 + buf.readUInt16LE(p + 2);
  }
  return false;
}

type Entry = { name: Buffer; utf8: boolean; data: Buffer };

/**
 * Returns a safe, uncompressed copy of the workbook to pass to XLSX.read, or throws an Error
 * with a user-facing French message.
 */
export function sanitizeXlsx(buf: Buffer, maxUncompressed = XLSX_MAX_UNCOMPRESSED): Buffer {
  let entries: Entry[];
  try {
    entries = readEntries(buf, maxUncompressed);
  } catch (e) {
    // Out-of-bounds read on a crafted file: refuse it, never a 500.
    throw new Error(e instanceof Error && (e as Error & { [REJECTED]?: boolean })[REJECTED] ? e.message : INVALID);
  }
  return writeStoredZip(entries);
}

function readEntries(buf: Buffer, maxUncompressed: number): Entry[] {
  if (buf.length < 22 || buf.readUInt32LE(0) !== LFH_SIG) reject();

  // Same search as SheetJS (backwards from length - 4, first signature wins); it must be the
  // only one in the area any zip reader may look at.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 4; i >= floor; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    if (eocd >= 0) reject();
    eocd = i;
  }
  if (eocd < 0 || eocd + 22 > buf.length) reject();
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) reject();
  const count = buf.readUInt16LE(eocd + 8);
  if (count !== buf.readUInt16LE(eocd + 10)) reject();
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) reject(ZIP64);
  if (count === 0) reject();
  if (count > MAX_ENTRIES) reject('classeur Excel trop complexe');
  if (cdOffset + cdSize !== eocd) reject();

  const out: Entry[] = [];
  let total = 0;
  let firstLocal = Number.MAX_SAFE_INTEGER;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CDH_SIG) reject();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csz = buf.readUInt32LE(p + 20);
    const usz = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) reject();
    if (csz === 0xffffffff || usz === 0xffffffff || hasZip64Extra(buf, p + 46 + nameLen, extraLen)) reject(ZIP64);
    if (flags & FLAG_ENCRYPTED) reject();
    if (method !== 0 && method !== 8) reject();

    if (local + 30 > cdOffset || buf.readUInt32LE(local) !== LFH_SIG) reject();
    firstLocal = Math.min(firstLocal, local);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    if (hasZip64Extra(buf, local + 30 + lNameLen, lExtraLen)) reject(ZIP64);
    if (buf.readUInt16LE(local + 8) !== method) reject();
    // With a data descriptor the local sizes may be 0; otherwise they must match the central ones.
    const lcsz = buf.readUInt32LE(local + 18);
    const lusz = buf.readUInt32LE(local + 22);
    const descriptor = (flags & FLAG_DATA_DESCRIPTOR) !== 0;
    if (!(lcsz === csz && lusz === usz) && !(descriptor && lcsz === 0 && lusz === 0)) reject();
    const dataStart = local + 30 + lNameLen + lExtraLen;
    if (dataStart + csz > cdOffset) reject();

    if (total + usz > maxUncompressed) {
      reject(`classeur Excel trop volumineux une fois décompressé (${Math.round(maxUncompressed / 1024 / 1024)} Mo maximum)`);
    }
    const raw = buf.subarray(dataStart, dataStart + csz);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: usz + 1 });
      } catch {
        reject(BAD_SIZE);
      }
    }
    if (data.length !== usz) reject(BAD_SIZE);
    total += usz;
    out.push({ name: Buffer.from(buf.subarray(p + 46, p + 46 + nameLen)), utf8: (flags & FLAG_UTF8) !== 0, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  // The archive starts with an entry (no data hidden before the first local header).
  if (p !== eocd || firstLocal !== 0) reject();
  return out;
}

/** Minimal zip writer: stored entries, exact sizes and CRC, no extra fields. */
function writeStoredZip(entries: Entry[]): Buffer {
  const DOS_DATE_1980 = 0x0021;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const crc = crc32(e.data);
    const flags = e.utf8 ? FLAG_UTF8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LFH_SIG, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(DOS_DATE_1980, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(e.name.length, 26);
    lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CDH_SIG, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(DOS_DATE_1980, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(e.name.length, 28);
    ch.writeUInt32LE(offset, 42);
    parts.push(lh, e.name, e.data);
    central.push(ch, e.name);
    offset += 30 + e.name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
