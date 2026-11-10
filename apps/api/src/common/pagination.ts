import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Errors } from './errors';

export class PageQuery {
  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor returned as next_cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const o = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof o.o === 'number' && o.o >= 0) return o.o;
  } catch {
    /* fallthrough */
  }
  throw Errors.validation({ cursor: 'curseur invalide' });
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

/** Offset pagination helper: fetches limit+1 rows through `fetch(offset, limit+1)`. */
export async function paginate<T, R = T>(
  q: { limit?: number; cursor?: string },
  fetch: (offset: number, take: number) => Promise<T[]>,
  map: (row: T) => R | Promise<R> = (r) => r as unknown as R,
): Promise<Page<R>> {
  const limit = Math.min(q.limit ?? 50, 500);
  const offset = decodeCursor(q.cursor);
  const rows = await fetch(offset, limit + 1);
  const more = rows.length > limit;
  const data = await Promise.all(rows.slice(0, limit).map(map));
  return { data, next_cursor: more ? encodeCursor(offset + limit) : null };
}

export function money(amountMinor: number | null | undefined, currency: string | null | undefined) {
  if (amountMinor === null || amountMinor === undefined) return null;
  return { amount_minor: Number(amountMinor), currency: currency ?? 'XAF' };
}
