import { browseSession, baseThresholds, makeSummary } from './lib/common.js';

const VUS = Number(__ENV.SOAK_VUS || 15);

export const options = {
  stages: [
    { duration: '2m', target: VUS },
    { duration: __ENV.SOAK_DURATION || '1h', target: VUS },
    { duration: '1m', target: 0 },
  ],
  thresholds: baseThresholds,
};

export default browseSession;
export const handleSummary = makeSummary('soak');
