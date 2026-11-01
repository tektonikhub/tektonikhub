const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const keys = { 'index.html': 'index', 'company-profile.html': 'companyProfile', 'profile.html': 'profile', 'app-catalog.html': 'catalog', 'create-app.html': 'creator', 'admin.html': 'admin', 'super-admin.html': 'superAdmin', 'login.html': 'login' };
for (const [filename, key] of Object.entries(keys)) {
  test(`Sintaxis, acceso compartido y bindings: ${filename}`, () => {
    const html = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.ok(html.includes('src="assets/js/data-store.js"'), 'Falta la capa compartida');
    const sources = [html];
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      new vm.Script(script[2], { filename });
      const src = /src="([^"]+)"/.exec(script[1]);
      if (src && !/^https?:/.test(src[1])) {
        const scriptPath = path.resolve(root, ...src[1].split('/'));
        assert.ok(fs.existsSync(scriptPath), `Script ausente: ${src[1]}`);
        const content = fs.readFileSync(scriptPath, 'utf8');
        new vm.Script(content, { filename: src[1] });
        sources.push(content);
      }
    }
    assert.ok(sources.some(source => source.includes('BLK.ready')), 'Falta inicialización asíncrona');
    for (const marker of html.matchAll(/<!--blk:text:([^>]+)-->|data-blk-(?:text|value|title|placeholder|alt)="([^"]+)"/g)) {
      assert.ok((marker[1] || marker[2]) in (data.content[key]?.texts || {}), `Binding ausente: ${marker[1] || marker[2]}`);
    }
  });
  test(`Enlaces locales válidos: ${filename}`, () => {
    const html = fs.readFileSync(path.join(root, filename), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|javascript:|\/\/)/.test(href) || href === '#' || href.includes('${')) continue;
      const url = new URL(href, `http://local/${filename}`);
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      assert.ok(fs.existsSync(target), `Enlace ausente: ${href}`);
      if (url.hash) {
        const destination = fs.readFileSync(target, 'utf8');
        assert.ok(destination.includes(`id="${url.hash.slice(1)}"`), `Anclaje ausente: ${href}`);
      }
    }
  });
}
