import { z } from 'zod';

export const MAX_PORTABLE_FILE_BYTES = 2_000_000;
export const LEGACY_PORTABLE_JSON_BYTES = 5 * 1024 * 1024;
export const htmlSourceSchema = z.string().max(MAX_PORTABLE_FILE_BYTES).refine(
  value => new TextEncoder().encode(value).byteLength <= MAX_PORTABLE_FILE_BYTES,
  'El HTML supera el límite de 2 MB (2.000.000 bytes UTF-8).',
);
