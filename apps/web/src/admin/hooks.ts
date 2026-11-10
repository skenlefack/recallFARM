import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, listOf } from '../api/endpoints';
import { useAuth } from './auth';

export const OPEN_ALERT_STATUSES = 'ouverte,escaladee';
export const TODO_REMINDER_STATUSES = 'en_retard,aujourdhui,manque';

export function useOpenAlerts() {
  const { orgId } = useAuth();
  return useQuery({
    queryKey: ['alerts', { status: OPEN_ALERT_STATUSES, orgId }],
    queryFn: () => api.alerts({ status: OPEN_ALERT_STATUSES, organisation_id: orgId! }),
    select: listOf,
    enabled: !!orgId,
    refetchInterval: 60_000,
  });
}

export function useOverdueCount() {
  const { orgId } = useAuth();
  return useQuery({
    queryKey: ['org-reminders', orgId, 'en_retard'],
    queryFn: () => api.orgReminders(orgId!, 'en_retard'),
    select: (x) => listOf(x).length,
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useOrganisation() {
  const { orgId } = useAuth();
  return useQuery({ queryKey: ['organisation', orgId], queryFn: () => api.organisation(orgId!), enabled: !!orgId, staleTime: 10 * 60_000 });
}

/* page title shown in the gradient header */
export type PageMeta = { title: string; subtitle?: string };
export const PageMetaCtx = createContext<(m: PageMeta) => void>(() => {});
export function usePageMeta(title: string, subtitle?: string) {
  const set = useContext(PageMetaCtx);
  useEffect(() => {
    set({ title, subtitle });
    document.title = `${title} · RecallFarm`;
  }, [set, title, subtitle]);
}
