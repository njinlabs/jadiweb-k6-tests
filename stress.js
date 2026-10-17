import { browseSession, makeSummary } from './lib/common.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 },
        { duration: '3m', target: 50 },
        { duration: '3m', target: 100 },
        { duration: '3m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    spike: {
      executor: 'ramping-vus',
      startTime: '15m30s', // setelah stress selesai
      startVUs: 5,
      stages: [
        { duration: '10s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '10s', target: 5 },
        { duration: '2m', target: 5 }, // lihat pemulihan
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Berhenti otomatis jika situs benar-benar rusak.
    http_req_failed: [{ threshold: 'rate<0.2', abortOnFail: true, delayAbortEval: '1m' }],
    http_req_duration: ['p(95)<5000'],
  },
};

export default browseSession;
export const handleSummary = makeSummary('stress');
