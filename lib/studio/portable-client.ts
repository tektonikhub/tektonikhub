'use client';

import { createBrowserClient } from '@insforge/sdk/ssr';
import { z } from 'zod';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';
import { requestJson } from '@/lib/data/http-client';
import { validatePortableFiles, type PortableFile } from './portable';
import { portableManifestSchema, type PortableManifest } from './portable-manifest';

const resultSchema = z.object({ id: z.uuid() });
export async function downloadPortableManifest(manifest: PortableManifest): Promise<PortableFile[]> {
  const client = createBrowserClient({ ...insforgeOptions(), ...cookieSettings });
  const files: PortableFile[] = [];
  for (const file of manifest.files) {
    const result = await client.storage.from('portable-apps').download(`${manifest.uploadId}/${file.name}`);
    if (result.error || !result.data) throw new Error('No se pudieron recuperar los assets autorizados de la aplicación.');
    if (result.data.size !== file.size) throw new Error('El tamaño de un asset no coincide con la versión guardada.');
    files.push({ name: file.name, type: file.type, content: await result.data.text() });
  }
  return validatePortableFiles(files);
}
export async function loadPortableBundle(appId: string, version: number): Promise<PortableFile[]> {
  const params = new URLSearchParams({ appId, version: String(version) });
  const manifest = portableManifestSchema.parse(await requestJson(`/api/studio/portable?${params}`));
  return downloadPortableManifest(manifest);
}
export async function submitPortableBundle(input: PortableFile[], fields: Record<string, unknown>, editing?: { id: string; version: number }): Promise<{ id: string }> {
  const files = validatePortableFiles(input);
  const metadata = files.map(file => ({ name: file.name, type: file.type, size: new TextEncoder().encode(file.content).byteLength }));
  const reservation = resultSchema.parse(await requestJson('/api/studio/portable', {
    method: 'POST', body: JSON.stringify({ action: 'reserve', files: metadata }),
  }));
  const client = createBrowserClient({ ...insforgeOptions(), ...cookieSettings });
  for (const file of files) {
    const key = `${reservation.id}/${file.name}`;
    const result = await client.storage.from('portable-apps').upload(key, new File([file.content], file.name, { type: file.type }));
    if (result.error) throw new Error('No se pudo guardar el fichero en InsForge. La aplicación no se ha enviado.');
  }
  const { generatedHtml: _html, attachments: _attachments, aiTool: _tool, ...metadataFields } = fields;
  void _html; void _attachments; void _tool;
  return resultSchema.parse(await requestJson('/api/studio/portable', {
    method: 'POST', body: JSON.stringify({ action: 'submit', uploadId: reservation.id, fields: metadataFields, ...editing }),
  }));
}
