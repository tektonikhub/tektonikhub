import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { OFFLINE_CSP } from '../lib/studio/engines';
import { portableFilesSchema, portableHTML, validatePortableFiles, type PortableFile } from '../lib/studio/portable';

const html: PortableFile = { name: 'app.HTML', type: 'text/html', content: '<!DOCTYPE html><html><head><title>Original</title></head><body><h1>Portable</h1></body></html>' };
const json: PortableFile = { name: 'data.json', type: 'application/json', content: '{"answer":42}' };

test('portable validation is strict, pure and allows HTML with optional valid JSON', () => {
  assert.deepEqual(validatePortableFiles([html, json]), [html, json]);
  assert.deepEqual(portableFilesSchema.parse([html]), [html]);
  assert.notEqual(validatePortableFiles([html, json])[0], html);
  for (const input of [null, {}, [], [json], [html, html], [{ ...html, content: ' \n ' }], [{ ...html, content: 'x'.repeat(300001) }], [{ ...html, extra: 'no' }], [html, { ...json, content: '{' }], [html, { ...json, type: 'text/plain' }], [html, { ...json, name: 'data.html' }], [{ ...html, name: 'app.json' }], [html, json, { ...json, name: 'DATA.JSON' }], [html, ...Array.from({ length: 10 }, (_, i) => ({ ...json, name: `${i}.json` }))]]) {
    assert.equal(portableFilesSchema.safeParse(input).success, false);
  }
});

test('unsafe filenames reject traversal, URLs, encoded characters and reserved aliases', () => {
  for (const name of ['../a.json', '..\\a.json', '/a.json', 'C:\\a.json', 'https://x/a.json', '//host/a.json', 'a%2f.json', 'a?x.json', 'a#x.json', 'a\u0000.json', 'a\n.json', '<script>.json', 'a".json', '.hidden.json', 'CON.json', 'nul.foo.json', 'LPT1.json', 'aux .json', 'a..json', 'a .json', 'a.json ', 'x'.repeat(116) + '.json']) {
    assert.equal(portableFilesSchema.safeParse([html, { ...json, name }]).success, false, name);
  }
  for (const name of ['sales 2026.json', 'metrics-v2.JSON', 'data_1.json']) assert.doesNotThrow(() => validatePortableFiles([html, { ...json, name }]));
});

test('UTF-8 JSON and total bundle size limits include metadata', () => {
  const fiveMiB = 5 * 1024 * 1024;
  const exact = { ...json, content: '"' + 'a'.repeat(fiveMiB - 2) + '"' };
  assert.doesNotThrow(() => validatePortableFiles([html, exact]));
  assert.throws(() => validatePortableFiles([html, { ...exact, content: '"' + 'é'.repeat(fiveMiB / 2) + '"' }]));
  const many = Array.from({ length: 5 }, (_, index) => ({ ...exact, name: `${index}.json` }));
  assert.throws(() => validatePortableFiles([html, ...many]), /25 MiB/);
  assert.doesNotThrow(() => validatePortableFiles([html, ...many.slice(0, 4)]));
});

test('server rendering preserves original markup and safely embeds untrusted JSON before all scripts', () => {
  const attack = '</script><script>window.compromised=true</script><!--\u2028\u2029';
  const original = '<!DOCTYPE HTML>\n<html lang="es"><head><!-- keep --><script>window.original=true</script></head><body>á</body></html>';
  const output = portableHTML([{ ...html, content: original }, { ...json, content: JSON.stringify({ attack, substitution: '$&' }) }]);
  assert.ok(output.startsWith('<!DOCTYPE HTML><meta'));
  assert.ok(output.endsWith(original.slice('<!DOCTYPE HTML>'.length)));
  assert.ok(output.includes(OFFLINE_CSP));
  assert.equal(output.split('<script>').length - 1, 2);
  assert.ok(!output.includes(attack));
  assert.ok(output.includes('\\u003c/script\\u003e'));
  assert.ok(output.indexOf('TektonikFiles') < output.indexOf('window.original=true'));
  assert.ok(portableHTML([{ ...html, content: '<script>window.first=true</script><p>fragment</p>' }]).endsWith('<script>window.first=true</script><p>fragment</p>'));
});

test('real opaque-origin iframe resolves fetch/XHR offline and keeps native imports/downloads', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route('**/*', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }); });
  try {
    await page.goto('https://portable.test/workspace');
    const source = portableHTML([{ ...html, content: `<!doctype html><html lang="es"><head><title>Original</title><script>
      window.initial = { api: !!window.TektonikFiles, data: window.TektonikFiles.read('data.json'), storage: localStorage.length };
    </script></head><body><h1>Original</h1><input type="file" id="import"><button id="save">Save</button><script>
      document.querySelector('#import').onchange = event => { const reader = new FileReader(); reader.onload = () => { window.imported = JSON.parse(reader.result); }; reader.readAsText(event.target.files[0]); };
      document.querySelector('#save').onclick = () => window.TektonikFiles.exportJSON('saved.json', { saved: 7 });
    </script></body></html>` }, { ...json, content: JSON.stringify({ answer: 42, attack: '</script><script>window.compromised=true</script>' }) }]);
    await page.evaluate(source => {
      const frame = document.createElement('iframe');
      frame.sandbox.add('allow-scripts', 'allow-downloads'); frame.srcdoc = source; document.body.append(frame);
    }, source);
    const iframe = page.frameLocator('iframe');
    await iframe.locator('h1').waitFor();
    const frame = page.frames().find(frame => frame.parentFrame())!;
    const result = await frame.evaluate(async () => {
      const win = window as typeof window & { initial: { api: boolean; data: { answer: number }; storage: number }; compromised?: boolean; TektonikFiles: { list(): string[]; read(name: string): unknown } };
      const fetched = await fetch('./data.json?cache=1#rows');
      const response = await fetched.json();
      const request = await fetch(new Request(new URL('data.json?request=1', document.baseURI)));
      const head = await fetch('data.json', { method: 'HEAD' });
      const failures: string[] = [];
      for (const input of ['missing.json', 'https://example.com/data.json', '//example.com/data.json', 'data.json/extra']) {
        try { await fetch(input); failures.push('allowed'); } catch (error) { failures.push((error as Error).name); }
      }
      try { await fetch(new Request('https://example.com/data.json')); failures.push('allowed'); } catch (error) { failures.push((error as Error).name); }
      try { await fetch('data.json', { method: 'POST' }); failures.push('allowed'); } catch (error) { failures.push((error as Error).name); }
      const controller = new AbortController(); controller.abort();
      let abort = ''; try { await fetch('data.json', { signal: controller.signal }); } catch (error) { abort = (error as Error).name; }
      let bodyBlocked = false;
      try { await fetch(new Request(new URL('data.json', document.baseURI), { method: 'POST', body: 'no' }), { method: 'GET' }); } catch { bodyBlocked = true; }
      const headXHR = new XMLHttpRequest(); headXHR.open('HEAD', 'data.json', false); headXHR.responseType = 'json'; headXHR.send();
      const byteXHR = new XMLHttpRequest(); byteXHR.open('GET', 'data.json', false); byteXHR.responseType = 'arraybuffer'; byteXHR.send();
      const decoded = JSON.parse(new TextDecoder().decode(byteXHR.response));
      const blockedResources = await Promise.all([
        new Promise<string>(resolve => { const script = document.createElement('script'); script.src = 'https://example.com/code.js'; script.onload = () => resolve('allowed'); script.onerror = () => resolve('blocked'); document.head.append(script); }),
        new Promise<string>(resolve => { const image = new Image(); image.onload = () => resolve('allowed'); image.onerror = () => resolve('blocked'); image.src = 'https://example.com/image.png'; })
      ]);
      const events: string[] = [];
      const xhr = await new Promise<{ status: number; data: unknown; header: string | null; textThrows: boolean }>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.onreadystatechange = () => events.push('state' + xhr.readyState);
        xhr.open('GET', './data.json?xhr=1#rows'); xhr.responseType = 'json'; xhr.setRequestHeader('Accept', 'application/json');
        xhr.onload = () => { let textThrows = false; try { void xhr.responseText; } catch { textThrows = true; } resolve({ status: xhr.status, data: xhr.response, header: xhr.getResponseHeader('Content-Type'), textThrows }); };
        xhr.onerror = reject; xhr.send();
      });
      const blockedXHR = await new Promise<string>(resolve => { const xhr = new XMLHttpRequest(); xhr.open('GET', 'https://example.com/data.json'); xhr.onerror = () => resolve('error:' + xhr.status); xhr.onload = () => resolve('allowed'); xhr.send(); });
      const xhrAbort = await new Promise<string>(resolve => { const xhr = new XMLHttpRequest(); xhr.open('GET', 'data.json'); xhr.onabort = () => resolve('abort:' + xhr.status); xhr.send(); xhr.abort(); });
      const sync = new XMLHttpRequest(); sync.open('GET', 'data.json', false); sync.send();
      localStorage.setItem('x', 'one'); sessionStorage.setItem('x', 'two'); localStorage.named = 3;
      const storage = [localStorage.getItem('x'), sessionStorage.getItem('x'), localStorage.named, localStorage.length, localStorage.key(0), Object.keys(localStorage)];
      delete localStorage.named;
      let parentDenied = false; try { void parent.document; } catch { parentDenied = true; }
      return { initial: win.initial, compromised: !!win.compromised, response, request: await request.json(), head: [head.status, await head.text()], bodyBlocked, headXHR: [headXHR.status, headXHR.response], decoded, blockedResources, failures, abort, xhr, events, blockedXHR, xhrAbort, sync: JSON.parse(sync.responseText), storage, parentDenied, list: win.TektonikFiles.list(), lang: document.documentElement.lang };
    });
    assert.equal(result.initial.api, true);
    assert.equal(result.initial.data.answer, 42);
    assert.equal(result.initial.storage, 0);
    assert.equal(result.compromised, false);
    assert.equal(result.response.answer, 42);
    assert.equal(result.request.answer, 42);
    assert.deepEqual(result.head, [200, '']);
    assert.equal(result.bodyBlocked, true);
    assert.deepEqual(result.headXHR, [200, null]);
    assert.equal(result.decoded.answer, 42);
    assert.deepEqual(result.blockedResources, ['blocked', 'blocked']);
    assert.deepEqual(result.failures, Array(6).fill('TypeError'));
    assert.equal(result.abort, 'AbortError');
    assert.equal(result.xhr.status, 200);
    assert.equal((result.xhr.data as { answer: number }).answer, 42);
    assert.equal(result.xhr.header, 'application/json; charset=utf-8');
    assert.equal(result.xhr.textThrows, true);
    assert.deepEqual(result.events, ['state1', 'state2', 'state3', 'state4']);
    assert.equal(result.blockedXHR, 'error:0');
    assert.equal(result.xhrAbort, 'abort:0');
    assert.equal(result.sync.answer, 42);
    assert.deepEqual(result.storage, ['one', 'two', '3', 2, 'x', ['x', 'named']]);
    assert.equal(result.parentDenied, true);
    assert.deepEqual(result.list, ['data.json']);
    assert.equal(result.lang, 'es');
    await iframe.locator('#import').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from('{"imported":9}') });
    await frame.waitForFunction(() => (window as typeof window & { imported?: { imported: number } }).imported?.imported === 9);
    const downloadEvent = page.waitForEvent('download');
    await iframe.locator('#save').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'saved.json');
    const stream = await download.createReadStream();
    assert.ok(stream);
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { saved: 7 });
    assert.deepEqual(requests, ['https://portable.test/workspace']);
    const blank = await context.newPage();
    await blank.setContent('<iframe sandbox="allow-scripts allow-downloads"></iframe>');
    await blank.locator('iframe').evaluate((element, src) => { (element as HTMLIFrameElement).srcdoc = src; }, portableHTML([html, json]));
    await blank.frameLocator('iframe').locator('h1').waitFor();
    const blankFrame = blank.frames().find(frame => frame.parentFrame())!;
    assert.equal(await blankFrame.evaluate(async () => (await (await fetch('./data.json')).json()).answer), 42);
    assert.equal(await blankFrame.evaluate(async () => { try { await fetch('../data.json'); return false; } catch { return true; } }), true);
  } finally { await context.close(); await browser.close(); }
});
