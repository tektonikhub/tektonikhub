'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createSpec, renderHTML } = require('../assets/js/studio-engine.js');

test('trusted local actions work in an allow-scripts-only iframe without native form submission', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    async function preview(kind) {
      await page.setContent('<iframe id="preview" sandbox="allow-scripts" title="Offline test"></iframe>');
      const html = renderHTML(createSpec(kind));
      await page.locator('#preview').evaluate((iframe, documentHTML) => { iframe.srcdoc = documentHTML; }, html);
      const frame = page.frameLocator('#preview');
      await frame.locator('body[data-kind="' + kind + '"]').waitFor();
      assert.equal(await page.locator('#preview').getAttribute('sandbox'), 'allow-scripts');
      const policy = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      assert.match(policy, /connect-src 'none'; form-action 'none'/);
      assert.equal(await frame.locator('body').evaluate(() => { try { void parent.document.body; return false; } catch { return true; } }), true);
      return frame;
    }

    let frame = await preview('form');
    await frame.locator('#request-list li').first().waitFor();
    assert.equal(await frame.locator('#request-list li').count(), 3);
    await frame.getByRole('button', { name: 'Añadir solicitud local' }).click();
    assert.equal(await frame.locator('#request-list li').count(), 3);
    await frame.locator('input[name="name"]').fill('   ');
    await frame.locator('input[name="subject"]').fill('Asunto válido');
    await frame.getByRole('button', { name: 'Añadir solicitud local' }).click();
    assert.equal(await frame.locator('#request-list li').count(), 3);
    await frame.locator('input[name="name"]').fill('Persona ficticia');
    await frame.locator('input[name="subject"]').fill('Solicitud offline');
    await frame.locator('textarea[name="details"]').fill('Primera línea');
    await frame.locator('textarea[name="details"]').press('Enter');
    assert.equal(await frame.locator('#request-list li').count(), 3);
    await frame.getByRole('button', { name: 'Añadir solicitud local' }).click();
    assert.equal(await frame.locator('#request-list li').count(), 4);
    assert.match(await frame.locator('#request-list li').first().textContent(), /Solicitud offline/);
    assert.equal(await frame.locator('input[name="name"]').inputValue(), '');
    assert.match(await frame.locator('#request-status').textContent(), /No se ha enviado a ningún servidor/);
    await frame.locator('input[name="name"]').fill('Persona teclado');
    await frame.locator('input[name="subject"]').fill('Solicitud Enter');
    await frame.locator('input[name="subject"]').press('Enter');
    assert.equal(await frame.locator('#request-list li').count(), 5);

    frame = await preview('kanban');
    await frame.locator('#todo-list article').first().waitFor();
    assert.equal(await frame.locator('#task-count').textContent(), '5');
    await frame.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    assert.equal(await frame.locator('#task-count').textContent(), '5');
    await frame.locator('input[name="task"]').fill('Tarea offline Next');
    await frame.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
    assert.equal(await frame.locator('#task-count').textContent(), '6');
    assert.match(await frame.locator('#todo-list').textContent(), /Tarea offline Next/);
    await frame.locator('input[name="task"]').fill('Tarea por teclado');
    await frame.locator('input[name="task"]').press('Enter');
    assert.equal(await frame.locator('#task-count').textContent(), '7');

    frame = await preview('calculator');
    await frame.locator('#hours').fill('8');
    await frame.getByRole('button', { name: 'Calcular ahorro' }).click();
    assert.match(await frame.locator('#savings').textContent(), /4[.\s]?800/);
    await frame.locator('#hours').press('Enter');
    assert.match(await frame.locator('#savings').textContent(), /4[.\s]?800/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
