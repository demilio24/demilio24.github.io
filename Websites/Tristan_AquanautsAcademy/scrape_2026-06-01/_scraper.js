// Scrapes Wix pages to markdown.
// usage: node _scraper.js <urls.txt> <out-dir>
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const [, , urlsFile, outDir] = process.argv;
if (!urlsFile || !outDir) {
  console.error('usage: node _scraper.js <urls.txt> <out-dir>');
  process.exit(1);
}

const urls = fs.readFileSync(urlsFile, 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });

function slugify(u) {
  let p;
  try { p = new URL(u).pathname.replace(/^\/+|\/+$/g, ''); } catch { p = ''; }
  if (!p) p = 'index';
  return p.replace(/\//g, '__').replace(/[^a-z0-9_\-]/gi, '-').slice(0, 140);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let ok = 0, fail = 0;
  for (const url of urls) {
    const slug = slugify(url);
    const outFile = path.join(outDir, slug + '.md');
    if (fs.existsSync(outFile)) { console.log('skip', slug); ok++; continue; }

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    // Block heavy resources for speed, keep CSS+JS+XHR so Wix can render text
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font') req.abort();
      else req.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));

      // Trigger lazy sections by scrolling
      await page.evaluate(async () => {
        await new Promise(res => {
          let y = 0;
          const step = 600;
          const timer = setInterval(() => {
            window.scrollBy(0, step);
            y += step;
            if (y >= document.body.scrollHeight) { clearInterval(timer); res(); }
          }, 120);
        });
        window.scrollTo(0, 0);
      });
      await new Promise(r => setTimeout(r, 1000));

      const data = await page.evaluate(() => {
        const meta = sel => (document.querySelector(sel)?.getAttribute('content') || '').trim();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map(h => ({ tag: h.tagName.toLowerCase(), text: (h.innerText || '').trim() }))
          .filter(h => h.text);
        const text = (document.body.innerText || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return {
          title: document.title || '',
          description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
          headings,
          text,
        };
      });

      const fm = [
        '---',
        `url: ${url}`,
        `title: ${JSON.stringify(data.title)}`,
        `description: ${JSON.stringify(data.description)}`,
        `scraped_at: ${new Date().toISOString()}`,
        '---',
        ''
      ].join('\n');

      const headingsBlock = data.headings.length
        ? '\n## Headings on page\n\n' + data.headings.map(h => `- (${h.tag}) ${h.text}`).join('\n') + '\n'
        : '';

      const md = fm
        + `# ${data.title || slug}\n`
        + (data.description ? `\n> ${data.description}\n` : '')
        + headingsBlock
        + '\n## Page text\n\n'
        + data.text
        + '\n';

      fs.writeFileSync(outFile, md, 'utf8');
      console.log('ok  ', slug);
      ok++;
    } catch (e) {
      console.error('FAIL', url, e.message);
      fs.writeFileSync(outFile + '.error.txt', `${url}\n${(e.stack || e.message)}\n`);
      fail++;
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close();
  console.log(`done. ok=${ok} fail=${fail}`);
  process.exit(fail > 0 ? 2 : 0);
})();
