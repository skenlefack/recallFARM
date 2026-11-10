/**
 * k6-api.js — Load test for RecallFarm public API endpoints.
 *
 * Run:
 *   k6 run tests/load/k6-api.js
 *   k6 run tests/load/k6-api.js --duration 30s --vus 50   # quick smoke
 *   k6 run tests/load/k6-api.js -e BASE_URL=https://pilote.recallfarm.app/v1
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:9080/v1';

const healthDuration = new Trend('health_duration', true);
const plansDuration  = new Trend('plans_duration', true);
const errorRate      = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 300 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed:   ['rate<0.01'],
    error_rate:        ['rate<0.01'],
  },
};

export default function () {
  const health = http.get(`${BASE}/health`);
  check(health, { 'health 200': (r) => r.status === 200 }) || errorRate.add(1);
  healthDuration.add(health.timings.duration);

  const ready = http.get(`${BASE}/ready`);
  check(ready, { 'ready 200': (r) => r.status === 200 }) || errorRate.add(1);

  const plans = http.get(`${BASE}/plans?country=CM`);
  check(plans, { 'plans 200': (r) => r.status === 200 }) || errorRate.add(1);
  plansDuration.add(plans.timings.duration);

  sleep(0.5);
}
