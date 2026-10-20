const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const counts = {};
const fixtures = {
  '/first': '<title>  First &amp; title  </title><h1>  One  &amp;  two  </h1><h1>Wrong</h1>',
  '/second': '<title>Second</title><h1>New heading</h1>',
  '/empty': '<title> </title><h1> </h1>',
  '/absent': '<p>No metadata</p>',
  '/safe': '<title>&lt;img src=x onerror=alert(1)&gt;</title><h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>',
  '/slow': '<title>Old</title><h1>Old heading</h1>'
};
const server = http.createServer((req, res) => {
  counts[req.url] = (counts[req.url] || 0) + 1;
  if (req.url === '/network') return req.socket.destroy();
  if (fixtures[req.url]) {
    const send = () => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixtures[req.url]); };
    return req.url === '/slow' ? setTimeout(send, 350) : send();
  }
  const filename = req.url === '/src/page-preview.js' && process.env.PUBLISHED_MODULE
    ? process.env.PUBLISHED_MODULE
    : path.join(__dirname, req.url === '/' ? 'demo/index.html' : req.url);
  if (!filename.startsWith(__dirname) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  fs.createReadStream(filename).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/demo/index.html`);
    await page.waitForFunction(() => [...document.querySelectorAll('page-preview')].every(e => ['ready', 'error'].includes(e.dataset.status)));
    const demo = await page.locator('page-preview').evaluateAll(els => els.map(e => ({status:e.dataset.status, open:e.shadowRoot.mode, title:e.shadowRoot.querySelector('[part=title]').textContent})));
    assert.deepEqual(demo.map(x => x.status), ['ready', 'error']);
    assert.equal(demo[0].title, 'Пробная страница');
    assert.equal(counts['/demo/example.html'], 1);
    console.log('PASS: HTTP demo, registration, open shadow, one initial request, 404');
    await page.evaluate(() => { window.preview = document.querySelector('page-preview'); });
    async function load(src, status = 'ready') {
      await page.evaluate(src => src === null ? preview.removeAttribute('src') : preview.setAttribute('src', src), src);
      await page.waitForFunction(s => preview.dataset.status === s, status);
      return page.evaluate(() => ({
        title: preview.shadowRoot.querySelector('[part=title]').textContent,
        heading: preview.shadowRoot.querySelector('[part=heading]').textContent,
        href: preview.shadowRoot.querySelector('[part=link]').href,
        link: preview.shadowRoot.querySelector('[part=link]').textContent,
        visible: preview.shadowRoot.querySelector('[part=link]').getBoundingClientRect().height > 0
      }));
    }
    const first = await load('../first');
    assert.equal(first.title, 'First & title');
    assert.equal(first.heading, 'One  &  two');
    assert.equal(first.href, `${base}/first`);
    assert.ok(first.visible && first.link.includes(first.title));
    for (const src of ['/empty', '/absent']) {
      const data = await load(src);
      assert.equal(data.title, 'Название отсутствует');
      assert.equal(data.heading, 'Заголовок отсутствует');
      assert.ok(data.link.includes(`${base}${src}`));
    }
    console.log('PASS: relative URL, entities, first h1, whitespace, missing metadata, visible link');
    await load(null, 'error');
    await load('/network', 'error');
    const safe = await load('/safe');
    assert.equal(safe.title, '<img src=x onerror=alert(1)>');
    assert.equal(safe.heading, '<script>alert(1)</script>');
    assert.equal(await page.evaluate(() => preview.shadowRoot.querySelectorAll('img,script').length), 0);
    await page.evaluate(() => { preview.setAttribute('src', '/slow'); preview.setAttribute('src', '/second'); });
    await page.waitForFunction(() => preview.dataset.status === 'ready');
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => preview.shadowRoot.querySelector('[part=title]').textContent), 'Second');
    console.log('PASS: missing src, network error, safe text, request race');
    await page.evaluate(() => { preview.setAttribute('src', '/slow'); preview.remove(); });
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => preview.dataset.status), 'loading');
    await page.evaluate(() => document.body.append(preview));
    await page.waitForFunction(() => preview.dataset.status === 'ready');
    assert.equal(await page.evaluate(() => preview.shadowRoot.querySelector('[part=title]').textContent), 'Old');
    assert.equal(await page.evaluate(() => document.querySelector('page-preview').dataset.status), 'error');
    assert.equal(await page.evaluate(() => preview.shadowRoot === document.querySelector('page-preview').shadowRoot), false);
    assert.deepEqual(errors, []);
    console.log('PASS: independent instances, disconnect, reconnect, no uncaught exceptions');
    await load('/first');
    fs.mkdirSync(path.join(__dirname, 'tmp'), {recursive:true});
    await page.screenshot({path:path.join(__dirname, 'tmp/demo.png')});
    console.log('ALL_CHECKS_PASSED');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
