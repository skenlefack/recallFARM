/**
 * Guards around XLSX.read (Q-SEC-01): an .xlsx is a zip, so the 5 MB upload limit only
 * bounds the compressed size. Before parsing, read the zip central directory and refuse
 * archives that would expand beyond a sane size (zip bomb), then parse a bounded number
 * of rows only (the parse is synchronous and blocks the event loop).
 */

/** Max total uncompressed size of all entries of an imported workbook. */
export const XLSX_MAX_UNCOMPRESSED = 40 * 1024 * 1024;
/** Max data rows (header excluded) of an imported workbook. */
export const XLSX_MAX_ROWS = 20_000;
const MAX_ENTRIES = 2_000;

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

/** Throws an Error with a user-facing French message when the archive is not acceptable. */
export function assertXlsxArchiveSafe(buf: Buffer, maxUncompressed = XLSX_MAX_UNCOMPRESSED): void {
  // End of central directory: 22 bytes + up to 64 KiB of comment, at the end of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('classeur Excel invalide');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('classeur Excel non pris en charge (zip64)');
  if (entries > MAX_ENTRIES) throw new Error('classeur Excel trop complexe');
  if (cdOffset + cdSize > eocd) throw new Error('classeur Excel invalide');

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CDH_SIG) throw new Error('classeur Excel invalide');
    const uncompressed = buf.readUInt32LE(p + 24);
    if (uncompressed === 0xffffffff) throw new Error('classeur Excel non pris en charge (zip64)');
    total += uncompressed;
    if (total > maxUncompressed) throw new Error(`classeur Excel trop volumineux une fois décompressé (${Math.round(maxUncompressed / 1024 / 1024)} Mo maximum)`);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}
