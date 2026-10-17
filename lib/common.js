import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { PAGES } from './pages.js';

export const BASE_URL = (__ENV.BASE_URL || 'https://jadiweb.id').replace(/\/$/, '');
// Persentase request yang menembus cache CDN (query acak), 0-100.
const CACHE_BUST_PCT = Number(__ENV.CACHE_BUST_PCT || 30);
const THINK_MIN = Number(__ENV.THINK_MIN || 1);
const THINK_MAX = Number(__ENV.THINK_MAX || 4);

export const rateLimited = new Counter('rate_limited_responses'); // 429 / 403
export const serverErrors = new Counter('server_errors'); // 5xx
export const cacheHit = new Rate('cache_hit');

// Hanya 200 dianggap sukses; 429/403/5xx masuk http_req_failed.
http.setResponseCallback(http.expectedStatuses(200));

const totalWeight = PAGES.reduce((s, p) => s + p.weight, 0);

function pickPage() {
  let r = Math.random() * totalWeight;
  for (const p of PAGES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PAGES[0];
}

function isCacheHit(res) {
  const status = (
    res.headers['Cf-Cache-Status'] ||
    res.headers['X-Cache'] ||
    res.headers['X-Vercel-Cache'] ||
    ''
  ).toLowerCase();
  if (status) return /hit|stale/.test(status);
  return res.headers['Age'] !== undefined && Number(res.headers['Age']) > 0;
}

export function visit(page) {
  const bust = Math.random() * 100 < CACHE_BUST_PCT;
  const sep = page.path.includes('?') ? '&' : '?';
  const cb = bust ? `${sep}cb=${Date.now()}${Math.floor(Math.random() * 1e6)}` : '';

  const res = http.get(`${BASE_URL}${page.path}${cb}`, {
    tags: { page_group: page.group, name: `${page.group}:${page.path}`, cache_bust: String(bust) },
  });

  if (res.status === 429 || res.status === 403) rateLimited.add(1);
  if (res.status >= 500) serverErrors.add(1);
  if (!bust) cacheHit.add(isCacheHit(res));

  check(res, {
    'status 200': (r) => r.status === 200,
    'body has <title>': (r) => typeof r.body === 'string' && r.body.includes('<title'),
    'body not empty': (r) => !!r.body && r.body.length > 500,
  });
  return res;
}

// Satu sesi pengunjung: buka 1-4 halaman dengan jeda baca.
export function browseSession() {
  const pages = 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < pages; i++) {
    visit(pickPage());
    sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
  }
}

// Kunjungi semua halaman sekali (untuk smoke).
export function visitAll() {
  for (const p of PAGES) {
    visit(p);
    sleep(0.5);
  }
}

export const baseThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  checks: ['rate>0.99'],
};

export function makeSummary(name) {
  return (data) => ({
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    [`results/${name}-summary.json`]: JSON.stringify(data, null, 2),
  });
}
