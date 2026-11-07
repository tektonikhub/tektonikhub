import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { portableManifestSchema, portableMetadataListSchema } from '../lib/studio/portable-manifest';

const html = { name: 'index.html', type: 'text/html', size: 100 };
const json = { name: 'data.json', type: 'application/json', size: 10 };
test('Portable manifests are bounded exact HTML/JSON metadata with no data or arbitrary URLs', () => {
  assert.equal(portableMetadataListSchema.parse([html, json]).length, 2);
  for (const files of [[json], [html, html], [html, { ...json, name: 'DATA.JSON' }, json],
    [html, { ...json, type: 'text/html' }], [html, { ...json, name: '../data.json' }],
    [html, { ...json, name: 'data.js' }], [html, { ...json, size: 5242881 }],
    [html, { ...json, content: '{}' }]]) {
    assert.equal(portableMetadataListSchema.safeParse(files).success, false);
  }
  assert.equal(portableManifestSchema.safeParse({ uploadId: 'not-an-id', files: [html] }).success, false);
});
test('Portable payloads bypass hosting body limits while application metadata stays same-origin', () => {
  const client = readFileSync('lib/studio/portable-client.ts', 'utf8');
  assert.match(client, /createBrowserClient/);
  assert.match(client, /\.upload\(key, new File/);
  assert.match(client, /\.download\(`/);
  assert.match(client, /action: 'reserve', files: metadata/);
  assert.match(client, /action: 'submit', uploadId: reservation.id, fields: metadataFields/);
  assert.doesNotMatch(client, /JSON\.stringify\(\{ files/);
  const route = readFileSync('app/api/studio/portable/route.ts', 'utf8');
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /authenticatedContext\(\)/);
  assert.match(route, /pendingPortableFiles\(client, input.uploadId\)/);
  assert.match(route, /readJson\(request, 20000\)/);
});
test('Portable storage guards prohibit mutation from upload onward and bundles remain versioned', () => {
  const sql = readFileSync('migrations/20261107073757_portable-storage-insert-only.sql', 'utf8');
  assert.match(sql, /AS RESTRICTIVE FOR UPDATE/);
  assert.match(sql, /AS RESTRICTIVE FOR DELETE/);
  assert.match(sql, /USING \(bucket <> 'portable-apps'\)/);
  assert.match(sql, /WHERE id = p_upload FOR UPDATE/);
  assert.match(sql, /uploaded_by = auth.uid\(\)::text/);
  assert.match(sql, /SET consumed = true/);
  const version = readFileSync('migrations/20261107072737_portable-app-assets.sql', 'utf8');
  assert.match(version, /FOREIGN KEY\(app_id, org_id, version\)/);
  assert.match(version, /a.version = p_version/);
  assert.match(version, /v.generated_html IS NOT DISTINCT FROM NEW.generated_html/);
});
test('InsForge HTML MIME normalization is narrow and used during finalization', () => {
  const sql = readFileSync('migrations/20261107075200_portable-html-storage-mime.sql', 'utf8');
  assert.match(sql, /f->>'type' = 'text\/html' AND p_type = 'application\/octet-stream'/);
  assert.match(sql, /p_size = \(f->>'size'\)::integer/);
  assert.match(sql, /public\.tk_portable_storage_access\(p_key, true\)/);
  assert.match(sql, /public\.tk_portable_storage_file\(key, size, mime_type\)/);
  assert.match(sql, /uploaded_by = auth.uid\(\)::text/);
});
