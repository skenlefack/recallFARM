/** One typed function per MVP endpoint used by the web app (docs/MVP-SCOPE.md §4). */
import { http, request } from './client';
import type {
  Alert,
  Batch,
  CertificateCheck,
  CheckoutRequest,
  DailyLog,
  Dashboard,
  Dog,
  ExportScope,
  Farm,
  FarmKpis,
  ImportCommitResult,
  ImportResult,
  Me,
  Member,
  Organisation,
  OrgRole,
  OtpRequestResponse,
  PackDiff,
  PackTestRun,
  PackVersion,
  Page,
  Payment,
  Plan,
  ProtocolSimulation,
  Reminder,
  StudioPack,
  Subscription,
  ValidationResult,
  VerifyResponse,
  PackContent,
} from './types';

/** Studio actions may answer `{ version, review }` instead of the bare version (real API). */
async function asVersion(x: Promise<PackVersion | { version: PackVersion }>): Promise<PackVersion> {
  const r = await x;
  return r && typeof (r as { version?: unknown }).version === 'object' ? (r as { version: PackVersion }).version : (r as PackVersion);
}

/** Accept `{data:[…]}` pages and bare arrays alike (tolerant to API evolution). */
export function listOf<T>(x: Page<T> | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : (x.data ?? []);
}

export const api = {
  /* auth */
  requestOtp: (phone: string) => http.post<OtpRequestResponse>('/auth/otp/request', { phone }, { auth: false }),
  verifyOtp: (phone: string, code: string) => http.post<VerifyResponse>('/auth/otp/verify', { phone, code }, { auth: false }),
  me: () => http.get<Me>('/me'),
  patchMe: (body: { name?: string; language?: string }) => http.patch<Me>('/me', body),

  /* public */
  plans: (country = 'CM') => http.get<Page<Plan> | Plan[]>('/plans', { country }, { auth: false }),
  lead: (body: { phone: string; name?: string; source: string }) => http.post<unknown>('/leads', body, { auth: false }),
  verifyCertificate: (payload: string) => http.get<CertificateCheck>('/certificates/verify', { payload }, { auth: false }),

  /* organisation */
  organisation: (id: string) => http.get<Organisation>(`/organisations/${id}`),
  dashboard: (id: string, q: { week?: string; speculation?: string }) => http.get<Dashboard>(`/organisations/${id}/dashboard`, q),
  orgFarms: (id: string, q?: string) => http.get<Page<Farm>>(`/organisations/${id}/farms`, { q }),
  orgReminders: (id: string, status?: string) => http.get<Page<Reminder>>(`/organisations/${id}/reminders`, { status }),
  members: (id: string) => http.get<Page<Member>>(`/organisations/${id}/members`),
  inviteMember: (id: string, body: { phone: string; role: OrgRole; name?: string }) => http.post<Member>(`/organisations/${id}/members`, body),
  patchMember: (memberId: string, body: { role: OrgRole }) => http.patch<Member>(`/members/${memberId}`, body),
  removeMember: (memberId: string) => http.del<void>(`/members/${memberId}`),

  /* farms */
  farm: (id: string) => http.get<Farm>(`/farms/${id}`),
  batches: (farmId: string) => http.get<Page<Batch>>(`/farms/${farmId}/batches`),
  dogs: (farmId: string) => http.get<Page<Dog>>(`/farms/${farmId}/dogs`),
  dailyLogs: (farmId: string) => http.get<Page<DailyLog>>(`/farms/${farmId}/daily-logs`, { limit: 10 }),
  farmKpis: (farmId: string, period: '7d' | '30d' = '7d') => http.get<FarmKpis>(`/farms/${farmId}/kpis`, { period }),
  reminders: (q: { farm_id?: string; status?: string; due_before?: string }) => http.get<Page<Reminder>>('/reminders', q),
  confirmReminder: (id: string) => http.post<Reminder>(`/reminders/${id}/confirm`, {}),
  snoozeReminder: (id: string, until: string) => http.post<Reminder>(`/reminders/${id}/snooze`, { until }),

  /* alerts */
  /** The API only accepts a single status: multi-status filters are applied client-side. */
  alerts: async (q: { farm_id?: string; status?: string; severity?: string; organisation_id?: string }): Promise<Page<Alert>> => {
    const multi = q.status?.includes(',') ? q.status.split(',') : null;
    const page = await http.get<Page<Alert>>('/alerts', multi ? { ...q, status: undefined } : q);
    return multi ? { ...page, data: listOf(page).filter((a) => multi.includes(a.status)) } : page;
  },
  ackAlert: (id: string) => http.post<Alert>(`/alerts/${id}/ack`, {}),
  resolveAlert: (id: string, body: { cause: string; action: string }) => http.post<Alert>(`/alerts/${id}/resolve`, body),

  /* subscription */
  currentSubscription: () => http.get<Subscription | null>('/subscriptions/current'),
  checkout: (body: CheckoutRequest) => http.post<{ payment_id: string; status: string; ussd_push: boolean }>('/subscriptions/checkout', body),
  payment: (id: string) => http.get<Payment>(`/payments/${id}`),

  /* import / export */
  importCsv: (file: File, organisationId: string, kind = 'farmers') => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('organisation_id', organisationId);
    form.set('file', file);
    return request<ImportResult>('POST', '/imports', { form });
  },
  commitImport: (jobId: string) => http.post<ImportCommitResult>(`/imports/${jobId}/commit`, {}),
  exportCsv: (body: { kind: 'csv'; scope: ExportScope; period: string; organisation_id?: string }) =>
    request<Response>('POST', '/exports', { body, raw: true }),

  /* params */
  packContent: (code: string, version: string) => http.get<{ pack: string; version: string; content: PackContent }>(`/params/packs/${code}/versions/${version}`),

  /* studio */
  studioPacks: () => http.get<Page<StudioPack>>('/studio/packs'),
  packVersions: (code: string) => http.get<Page<PackVersion>>(`/studio/packs/${code}/versions`),
  createDraft: (code: string) => http.post<PackVersion>(`/studio/packs/${code}/versions`, {}),
  version: (id: string) => http.get<PackVersion>(`/studio/versions/${id}`),
  patchVersion: (id: string, content: PackContent) => asVersion(http.patch(`/studio/versions/${id}`, { content })),
  validateVersion: (id: string) => http.post<ValidationResult>(`/studio/versions/${id}/validate`, {}),
  testVersion: (id: string) => http.post<PackTestRun>(`/studio/versions/${id}/test`, {}),
  submitVersion: (id: string) => asVersion(http.post(`/studio/versions/${id}/submit`, {})),
  reviewVersion: (id: string, body: { decision: 'approuve' | 'refuse'; comments: string }) => asVersion(http.post(`/studio/versions/${id}/reviews`, body)),
  publishVersion: (id: string, rollout_pct?: number) => asVersion(http.post(`/studio/versions/${id}/publish`, { rollout_pct })),
  rollback: (code: string, body: { to_version: string; reason: string }) => http.post<PackVersion>(`/studio/packs/${code}/rollback`, body),
  diff: (id: string) => http.get<PackDiff>(`/studio/versions/${id}/diff`),
  simulateProtocol: (body: { version_id: string; protocol_code: string; birth_or_start_date: string }) =>
    http.post<ProtocolSimulation>('/studio/simulate-protocol', body),
};
