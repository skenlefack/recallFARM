import { BadRequestException, CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, Type, mixin } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Observable } from 'rxjs';

/** Limites de multer 2.5 absentes des types Nest 10 (`fieldNestingDepth`, `fieldArrayIndexLimit` sont opt-in). */
type MultipartLimits = NonNullable<MulterOptions['limits']> & { fieldNestingDepth: number; fieldArrayIndexLimit: number };

/**
 * Limites de tout formulaire multipart de l'API : un fichier, quelques champs plats.
 * - fieldNestingDepth 0 / fieldArrayIndexLimit 0 : aucun nom `a[b]` ni `a[999999999]` (CVE-2026-82333, -5079, -77078) ;
 * - fields / parts / files : borne le nombre de parties lues (CVE-2026-3304, -3520) ;
 * - fieldNameSize / fieldSize : noms et valeurs courts.
 */
export const SAFE_MULTIPART_LIMITS: Readonly<Omit<MultipartLimits, 'fileSize'>> = Object.freeze({
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
  fields: 10,
  files: 1,
  parts: 11,
  fieldNameSize: 100,
  fieldSize: 64 * 1024,
});

/** Erreur multer (refus d'une limite, nom invalide) -> 400, que le filtre global rend en 422 VALIDATION_ERROR. */
export function toMultipartError(e: unknown): unknown {
  if (e instanceof HttpException) return e;
  if (e instanceof Error && e.name === 'MulterError') {
    const code = (e as Error & { code?: unknown }).code;
    return new BadRequestException(`Formulaire multipart refuse (${typeof code === 'string' ? code : 'invalide'})`);
  }
  return e;
}

/**
 * Remplace `FileInterceptor(field, { limits: { fileSize } })` : memes effets, avec les limites de
 * SAFE_MULTIPART_LIMITS et des refus multer en 4xx au lieu de 500.
 */
export function SafeFileInterceptor(field: string, maxFileSize: number): Type<NestInterceptor> {
  const limits: MultipartLimits = { ...SAFE_MULTIPART_LIMITS, fileSize: maxFileSize };
  const Inner = FileInterceptor(field, { limits });

  @Injectable()
  class SafeFileMixin implements NestInterceptor {
    private readonly inner = new Inner();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.inner.intercept(context, next);
      } catch (e) {
        throw toMultipartError(e);
      }
    }
  }
  return mixin(SafeFileMixin);
}
