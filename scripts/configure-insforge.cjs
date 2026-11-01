'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const linked = JSON.parse(fs.readFileSync(path.join(root, '.insforge', 'project.json'), 'utf8'));
const envPath = path.join(root, '.env.local');
let source = fs.readFileSync(envPath, 'utf8');
const anonLine = source.split(/\r?\n/).find(line => line.startsWith('NEXT_PUBLIC_INSFORGE_ANON_KEY='));
if (!anonLine || !linked.api_key || !linked.oss_host) throw new Error('Falta la conexión InsForge o la clave anónima local.');
const values = {
  NEXT_PUBLIC_INSFORGE_URL: linked.oss_host,
  NEXT_PUBLIC_INSFORGE_ANON_KEY: anonLine.slice(anonLine.indexOf('=') + 1).replace(/^["']|["']$/g, ''),
  NEXT_PUBLIC_APP_URL: 'https://vxpd968k.insforge.site',
  APP_URL: 'https://vxpd968k.insforge.site',
  INSFORGE_API_KEY: linked.api_key,
  BLK_ENABLE_LOCAL_LLM: 'false',
};
for (const [key, value] of Object.entries(values)) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:/-]+$/.test(value)) throw new Error(`Valor de configuración no válido: ${key}`);
  source = source.split(/\r?\n/).filter(line => !line.startsWith(key + '=')).join('\n').trimEnd() + `\n${key}=${value}\n`;
}
fs.writeFileSync(envPath, source, { mode: 0o600 });
console.log('Entorno local configurado; no se muestran credenciales.');
if (process.argv.includes('--deploy')) {
  for (const [key, value] of Object.entries(values)) {
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['-y', '@insforge/cli@latest', 'deployments', 'env', 'set', key, value, '--json'],
      { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`No se pudo configurar ${key} en el despliegue (estado ${result.status}).`);
    console.log(`Configurada variable de despliegue: ${key}`);
  }
}
