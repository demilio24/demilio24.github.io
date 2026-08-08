#!/usr/bin/env node
/**
 * BabyLoveGrowth post-process for Nils Digital website.
 *
 * Reads a raw BabyLoveGrowth-published post at blog/posts/<slug>.html,
 * extracts metadata from <meta> tags, wraps the body in blog/_template.html,
 * and injects the inline CTA based on the post's primary tag.
 *
 * Usage:  node scripts/inject-post-cta.mjs blog/posts/<slug>.html
 *
 * Adapt parseMeta() if BabyLoveGrowth's output format differs from
 * the assumed <meta name="blg-..."> conventions below.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error('Usage: node scripts/inject-post-cta.mjs blog/posts/<slug>.html');
  process.exit(1);
}

const SITE_ROOT = resolve(__dirname, '..');
const TEMPLATE_PATH = resolve(SITE_ROOT, 'blog/_template.html');
const POST_PATH = resolve(process.cwd(), inputPath);

const CTA_BY_TAG = {
  marketing: {
    headline: 'Want this kind of growth for your business?',
    body: 'We run super profitable Google Ads and build the website that converts them.',
    button: 'See the marketing system',
    href: '../../funnel/vsl.html',
    cls: 'marketing'
  },
  automation: {
    headline: 'Want to reclaim hours every week?',
    body: 'Our audit shows you exactly where AI plus automation save the most time in your business.',
    button: 'See the audit',
    href: '../../funnel/automation-vsl-funnel-direct.html',
    cls: 'automation'
  }
};

function parseMeta(raw) {
  const get = (name) => {
    const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
    const m = raw.match(re);
    return m ? m[1] : '';
  };
  const getOg = (prop) => {
    const re = new RegExp(`<meta\\s+property=["']${prop}["']\\s+content=["']([^"']+)["']`, 'i');
    const m = raw.match(re);
    return m ? m[1] : '';
  };
  const titleMatch = raw.match(/<title>([^<]+)<\/title>/i);
  return {
    title:       (titleMatch ? titleMatch[1] : '').replace(/\s*\|\s*Nils Digital\s*$/, ''),
    description: get('description'),
    tag:         get('blg-tag') || getOg('article:tag') || 'marketing',
    author:      get('author') || 'Nils Digital',
    dateIso:     get('blg-date') || new Date().toISOString(),
    readTime:    get('blg-read-time') || '4',
    subtitle:    get('blg-subtitle') || ''
  };
}

function extractBody(raw) {
  const m = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1].trim() : raw;
}

function renderCta(tag) {
  const c = CTA_BY_TAG[tag.toLowerCase()] || CTA_BY_TAG.marketing;
  return `
    <aside class="post-cta ${c.cls}">
      <h3>${c.headline}</h3>
      <p>${c.body}</p>
      <a class="btn" href="${c.href}">${c.button} →</a>
    </aside>
  `;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const raw = readFileSync(POST_PATH, 'utf8');
const meta = parseMeta(raw);
const body = extractBody(raw);
const slug = basename(POST_PATH, '.html');
const template = readFileSync(TEMPLATE_PATH, 'utf8');

const canonical = `https://nilsdigital.com/Nils/website/blog/posts/${slug}.html`;

const final = template
  .replace(/{{TITLE}}/g, meta.title)
  .replace(/{{DESCRIPTION}}/g, meta.description)
  .replace(/{{CANONICAL_URL}}/g, canonical)
  .replace(/{{TAG}}/g, meta.tag)
  .replace(/{{TAG_SLUG}}/g, meta.tag.toLowerCase())
  .replace(/{{AUTHOR}}/g, meta.author)
  .replace(/{{READ_TIME}}/g, meta.readTime)
  .replace(/{{SUBTITLE}}/g, meta.subtitle)
  .replace(/{{DATE_ISO}}/g, meta.dateIso)
  .replace(/{{DATE_PRETTY}}/g, formatDate(meta.dateIso))
  .replace(/{{BODY}}/g, body)
  .replace(/<!--\s*{{CTA}}\s*-->/, renderCta(meta.tag));

writeFileSync(POST_PATH, final, 'utf8');
console.log(`Processed: ${POST_PATH}  (tag: ${meta.tag})`);
