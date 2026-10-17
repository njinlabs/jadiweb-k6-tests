import { browseSession, baseThresholds, makeSummary } from './lib/common.js';

const PEAK = Number(__ENV.PEAK_VUS || 20);

export const options = {
  stages: [
    { duration: '2m', target: PEAK }, // naik
    { duration: '6m', target: PEAK }, // tahan
    { duration: '2m', target: 0 }, // turun
  ],
  thresholds: baseThresholds,
};

export default browseSession;
export const handleSummary = makeSummary('load');
