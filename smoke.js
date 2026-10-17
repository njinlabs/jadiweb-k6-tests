import { visitAll, baseThresholds, makeSummary } from './lib/common.js';

export const options = {
  vus: 2,
  duration: '1m',
  thresholds: baseThresholds,
};

export default visitAll;
export const handleSummary = makeSummary('smoke');
