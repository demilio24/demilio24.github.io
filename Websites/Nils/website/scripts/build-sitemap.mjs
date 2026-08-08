#!/usr/bin/env node
/**
 * Regenerate Nils/website/sitemap.xml from the current state of the site.
 *
 * Includes:
 *   - Home   (/Nils/website/)
 *   - Blog   (/Nils/website/blog/)
 *   - Every published post under blog/posts/*.html
 *
 * Skips:
 *   - blog/posts/_*.html  (drafts / templates, leading underscore)
 *   - Anything tagged <meta name="robots" content="noindex">
 *
 * Post lastmod comes from the post's <meta name="blg-date"> if present,
 * else the file mtime. Static-page lastmod is today's date.
 *
 * Usage:  node Nils/website/scripts/build-sitemap.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(__dirname, '..');
const POSTS_DIR = resolve(SITE_ROOT, 'blog/posts');
const OUT_PATH  = resolve(SITE_ROOT, 'sitemap.xml');
const BASE_URL  = 'https://nilsdigital.com/Nils/website';

const today = new Date().toISOString().slice(0, 10);

function readMeta(html, name) {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

function isNoindex(html) {
  const robots = readMeta(html, 'robots').toLowerCase();
  return robots.includes('noindex');
}

function collectPosts() {
  let entries;
  try {
    entries = readdirSync(POSTS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => {
      const path = resolve(POSTS_DIR, f);
      const html = readFileSync(path, 'utf8');
      if (isNoindex(html)) return null;
      const blgDate = readMeta(html, 'blg-date');
      const lastmod = blgDate
        ? blgDate.slice(0, 10)
        : statSync(path).mtime.toISOString().slice(0, 10);
      return {
        loc: `${BASE_URL}/blog/posts/${basename(f)}`,
        lastmod,
        changefreq: 'monthly',
        priority: '0.7'
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

function renderUrl(u) {
  return `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`;
}

const urls = [
  { loc: `${BASE_URL}/`,      lastmod: today, changefreq: 'weekly', priority: '1.0' },
  { loc: `${BASE_URL}/blog/`, lastmod: today, changefreq: 'weekly', priority: '0.9' },
  ...collectPosts()
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(renderUrl).join('\n')}
</urlset>
`;

writeFileSync(OUT_PATH, xml, 'utf8');
console.log(`Wrote ${OUT_PATH} (${urls.length} URL${urls.length === 1 ? '' : 's'})`);
