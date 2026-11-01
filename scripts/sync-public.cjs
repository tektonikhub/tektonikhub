'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
fs.mkdirSync(path.join(publicDir, 'engines'), { recursive: true });
fs.rmSync(path.join(publicDir, 'legacy'), { recursive: true, force: true });
fs.rmSync(path.join(publicDir, 'data.json'), { force: true });
for (const name of ['studio-engine.js', 'dashboard-kit.js']) {
  fs.copyFileSync(path.join(root, 'lib', 'studio', 'runtime', name), path.join(publicDir, 'engines', name));
}
console.log('Motores de Studio sincronizados.');
