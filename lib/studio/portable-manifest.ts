import { z } from 'zod';

export const portableMetadataSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._ -]*\.(html|json)$/i).refine(value => !value.includes('..')),
  type: z.enum(['text/html', 'application/json']), size: z.number().int().positive().max(5242880),
}).strict();
export const portableMetadataListSchema = z.array(portableMetadataSchema).min(1).max(10).superRefine((files, context) => {
  const invalid = files.filter(file => file.type === 'text/html').length !== 1
    || new Set(files.map(file => file.name.toLowerCase())).size !== files.length
    || files.reduce((total, file) => total + file.size, 0) > 26214400
    || files.some(file => file.type !== (file.name.toLowerCase().endsWith('.html') ? 'text/html' : 'application/json'));
  if (invalid) context.addIssue({ code: 'custom', message: 'Selecciona un HTML y sus JSON, con nombres únicos y hasta 25 MB.' });
});
export const portableManifestSchema = z.object({ uploadId: z.uuid(), files: portableMetadataListSchema }).strict();
export type PortableManifest = z.infer<typeof portableManifestSchema>;
