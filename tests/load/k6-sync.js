/**
 * k6-sync.js — Realistic sync scenario for RecallFarm API.
 *
 * Simulates OTP requests, health polling, unauthenticated sync pull.
 *
 * Run:
 *   k6 run tests/load/k6-sync.js --duration 30s --vus 20
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:9080/v1';

const DEMO_PHONES = [
  '+237690000001', '+237690000002', '+237690000003',
  '+237690000004', '+237690000005',
];

const otpDuration  = new Trend('otp_request_duration', true);
const syncDuration = new Trend('sync_pull_duration', true);
const errorRate    = new Rate('error_rate');
const otpRequests  = new Counter('otp_requests');

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '40s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    error_rate:        ['rate<0.05'],
  },
};

export default function () {
  const phone = DEMO_PHONES[Math.floor(Math.random() * DEMO_PHONES.length)];

  const otpRes = http.post(
    `${BASE}/auth/otp/request`,
    JSON.stringify({ phone }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(otpRes, {
    'otp 200 or 429': (r) => r.status === 200 || r.status === 429,
  }) || errorRate.add(1);
  otpDuration.add(otpRes.timings.duration);
  otpRequests.add(1);

  sleep(0.3);

  const health = http.get(`${BASE}/health`);
  check(health, { 'health 200': (r) => r.status === 200 }) || errorRate.add(1);

  const syncRes = http.get(`${BASE}/sync/pull?since=0`);
  check(syncRes, {
    'sync 401 (unauth)': (r) => r.status === 401,
  }) || errorRate.add(1);
  syncDuration.add(syncRes.timings.duration);

  sleep(0.5);
}
