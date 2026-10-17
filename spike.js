import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { PAGES } from './lib/pages.js';

// MODE=hit : selalu GET beranda (kemungkinan kena cache)
// MODE=miss: GET bergantian ke daftar halaman nyata
const MODE = __ENV.MODE === 'miss' ? 'miss' : 'hit';
const BASE_URL = (__ENV.BASE_URL || 'https://jadiweb.id').replace(/\/$/, '');
// Untuk uji coba cepat: RATE_SCALE=0.05 TIME_SCALE=0.1 (default 1 = skenario penuh).
const RATE_SCALE = Number(__ENV.RATE_SCALE || 1);
const TIME_SCALE = Number(__ENV.TIME_SCALE || 1);

const HIT_URL = `${BASE_URL}/`;
const MISS_URLS = PAGES.map((p) => `${BASE_URL}${p.path}`);

// Hanya 200 dianggap sukses, sisanya masuk http_req_failed.
http.setResponseCallback(http.expectedStatuses(200));

const non200 = new Counter('non_200_responses');

const PHASES = ['warmup', 'spike1', 'recovery1', 'spike2', 'recovery2'];

const rate = (r) => Math.max(1, Math.round(r * RATE_SCALE));
const secs = (s) => Math.max(1, Math.round(s * TIME_SCALE));

// Satu fase = satu scenario berurutan (startTime = akhir fase sebelumnya),
// supaya setiap request punya tag 'phase'.
function buildScenarios() {
  const defs = [
    // 1. warmup: 10 rps selama 1 menit
    { name: 'warmup', startRate: 10, pre: 20, max: 100, stages: [{ d: 60, t: 10 }] },
    // 2. spike1: naik ke 150 rps dalam 10 detik, tahan 2 menit
    { name: 'spike1', startRate: 10, pre: 300, max: 1500, stages: [{ d: 10, t: 150 }, { d: 120, t: 150 }] },
    // 3. recovery1: turun ke 10 rps selama 2 menit
    { name: 'recovery1', startRate: 150, pre: 100, max: 1500, stages: [{ d: 120, t: 10 }] },
    // 4. spike2: naik ke 400 rps dalam 10 detik, tahan 2 menit
    { name: 'spike2', startRate: 10, pre: 800, max: 4000, stages: [{ d: 10, t: 400 }, { d: 120, t: 400 }] },
    // 5. recovery2: turun ke 10 rps selama 2 menit
    { name: 'recovery2', startRate: 400, pre: 200, max: 4000, stages: [{ d: 120, t: 10 }] },
  ];

  const scenarios = {};
  let offset = 0;
  for (const def of defs) {
    scenarios[def.name] = {
      executor: 'ramping-arrival-rate',
      startTime: `${offset}s`,
      startRate: rate(def.startRate),
      timeUnit: '1s',
      preAllocatedVUs: def.pre,
      maxVUs: def.max,
      stages: def.stages.map((s) => ({ duration: `${secs(s.d)}s`, target: rate(s.t) })),
      gracefulStop: '10s',
      tags: { phase: def.name },
    };
    offset += def.stages.reduce((sum, s) => sum + secs(s.d), 0) + 10; // jeda kecil antar fase
  }
  return scenarios;
}

// Threshold bernilai selalu benar hanya agar k6 menghitung sub-metrik per fase.
const phaseThresholds = {};
for (const ph of PHASES) {
  phaseThresholds[`http_req_duration{phase:${ph}}`] = ['p(95)<1500']; // pelaporan, tidak menghentikan test
  phaseThresholds[`http_req_failed{phase:${ph}}`] = ['rate>=0'];
  phaseThresholds[`http_reqs{phase:${ph}}`] = ['count>=0'];
  phaseThresholds[`dropped_iterations{phase:${ph}}`] = ['count>=0'];
  phaseThresholds[`non_200_responses{phase:${ph}}`] = ['count>=0'];
}

export const options = {
  scenarios: buildScenarios(),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    // Hentikan test jika lebih dari 5% request gagal.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '10s' }],
    ...phaseThresholds,
  },
};

export default function () {
  const url = MODE === 'hit' ? HIT_URL : MISS_URLS[exec.scenario.iterationInTest % MISS_URLS.length];
  const phase = exec.scenario.name;

  const res = http.get(url, { tags: { mode: MODE } });

  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  if (!ok) non200.add(1, { phase });
}

// ---------- ringkasan ----------

function vals(data, name) {
  const m = data.metrics[name];
  return (m && (m.values || m)) || {};
}

function round(n) {
  return typeof n === 'number' ? Math.round(n * 100) / 100 : 0;
}

function phaseStats(data, ph) {
  const dur = vals(data, `http_req_duration{phase:${ph}}`);
  const failed = vals(data, `http_req_failed{phase:${ph}}`);
  return {
    requests: vals(data, `http_reqs{phase:${ph}}`).count || 0,
    failed: failed.passes || 0, // Rate: passes = jumlah kejadian "gagal"
    avg_ms: round(dur.avg),
    p95_ms: round(dur['p(95)']),
    p99_ms: round(dur['p(99)']),
    max_ms: round(dur.max),
    non_200: vals(data, `non_200_responses{phase:${ph}}`).count || 0,
    dropped_iterations: vals(data, `dropped_iterations{phase:${ph}}`).count || 0,
  };
}

function pad(s, n) {
  return String(s).padEnd(n);
}

export function handleSummary(data) {
  const phases = {};
  for (const ph of PHASES) phases[ph] = phaseStats(data, ph);

  const header = ['phase', 'reqs', 'failed', 'avg', 'p95', 'p99', 'max', 'non200', 'dropped'];
  const lines = [`\nSpike test - MODE=${MODE} - ${BASE_URL}\n`, header.map((h) => pad(h, 11)).join('')];
  for (const ph of PHASES) {
    const s = phases[ph];
    lines.push(
      [ph, s.requests, s.failed, s.avg_ms, s.p95_ms, s.p99_ms, s.max_ms, s.non_200, s.dropped_iterations]
        .map((v) => pad(v, 11))
        .join('')
    );
  }
  lines.push('\n(latensi dalam ms)\n');

  return {
    stdout: lines.join('\n'),
    [`summary-${MODE}.json`]: JSON.stringify({ mode: MODE, target: BASE_URL, phases }, null, 2),
  };
}
