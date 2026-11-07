import 'server-only';
import type { userClient } from './insforge';
import { databaseError, HttpError } from './http';
import { portableManifestSchema, type PortableManifest } from '@/lib/studio/portable-manifest';
import { validatePortableFiles, type PortableFile } from '@/lib/studio/portable';

type Client = Awaited<ReturnType<typeof userClient>>;
export async function portableManifest(client: Client, appId: string, version: number): Promise<PortableManifest | null> {
  const result = await client.database.rpc('tk_portable_manifest', { p_app: appId, p_version: version });
  if (result.error) databaseError(result.error);
  return result.data === null ? null : portableManifestSchema.parse(result.data);
}
export async function pendingPortableFiles(client: Client, uploadId: string): Promise<PortableFile[]> {
  const result = await client.database.rpc('tk_portable_pending', { p_upload: uploadId });
  if (result.error) databaseError(result.error);
  const manifest = portableManifestSchema.parse(result.data);
  const files: PortableFile[] = [];
  for (const file of manifest.files) {
    const asset = await client.storage.from('portable-apps').download(`${manifest.uploadId}/${file.name}`);
    if (asset.error || !asset.data) throw new HttpError(409, 'No se han guardado todos los assets. Vuelve a enviar la aplicación.');
    if (asset.data.size !== file.size) throw new HttpError(409, 'El tamaño del asset no coincide con la carga reservada.');
    files.push({ name: file.name, type: file.type, content: await asset.data.text() });
  }
  return validatePortableFiles(files);
}
