import { z } from 'zod';
import { MAX_PORTABLE_FILE_BYTES, LEGACY_PORTABLE_JSON_BYTES } from './limits';

export const portableMetadataSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._ -]*\.(html|json)$/i).refine(value => !value.includes('..')),
  type: z.enum(['text/html', 'application/json']), size: z.number().int().positive().max(MAX_PORTABLE_FILE_BYTES),
}).strict();
const metadataList = (metadata: typeof portableMetadataSchema) => z.array(metadata).min(1).max(10).superRefine((files, context) => {
  const invalid = files.filter(file => file.type === 'text/html').length !== 1
    || new Set(files.map(file => file.name.toLowerCase())).size !== files.length
    || files.reduce((total, file) => total + file.size, 0) > 26214400
    || files.some(file => file.type !== (file.name.toLowerCase().endsWith('.html') ? 'text/html' : 'application/json')
      || file.type === 'text/html' && file.size > MAX_PORTABLE_FILE_BYTES);
  if (invalid) context.addIssue({ code: 'custom', message: 'Selecciona un HTML y sus JSON, con nombres únicos y hasta 25 MB.' });
});
export const portableMetadataListSchema = metadataList(portableMetadataSchema);
const storedMetadataListSchema = metadataList(portableMetadataSchema.extend({ size: z.number().int().positive().max(LEGACY_PORTABLE_JSON_BYTES) }));
export const portableManifestSchema = z.object({ uploadId: z.uuid(), files: storedMetadataListSchema }).strict();
export type PortableManifest = z.infer<typeof portableManifestSchema>;
