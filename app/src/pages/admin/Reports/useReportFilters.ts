import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ListParams, ReportFilterParams, RangePreset } from '@/services/report.service';

// All report state lives in the URL, so a view can be shared and back/forward work. Filter changes push a history entry.

const FILTER_KEYS = ['range', 'from', 'to', 'granularity', 'customerId', 'industry', 'statusGroup', 'mode', 'currency'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Per-table state keys: s = shipments by customer, r = revenue by customer, c = customers report. */
export type TableId = 's' | 'r' | 'c';
const TABLE_DEFAULTS: Record<TableId, { sort: string; dir: 'asc' | 'desc' }> = {
  s: { sort: 'created', dir: 'desc' },
  r: { sort: 'collected', dir: 'desc' },
  c: { sort: 'name', dir: 'asc' },
};

export function useReportFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<ReportFilterParams>(() => {
    const out: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value;
    }
    out.range = (out.range as RangePreset) || 'this_month';
    if (out.range !== 'custom') {
      delete out.from;
      delete out.to;
    }
    return out as ReportFilterParams;
  }, [params]);

  /** A stable string for effect dependencies. */
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const setFilters = useCallback((patch: Partial<Record<FilterKey, string | undefined>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.get('range') !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    // A different slice of data: every table goes back to its first page.
    for (const id of ['s', 'r', 'c'] as const) next.delete(`${id}page`);
    setParams(next);
  }, [params, setParams]);

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    setParams(next);
  }, [setParams]);

  const table = useCallback((id: TableId): ListParams => {
    const d = TABLE_DEFAULTS[id];
    const page = Number(params.get(`${id}page`)) || 1;
    return {
      page: page > 0 ? page : 1,
      pageSize: 25,
      sort: params.get(`${id}sort`) || d.sort,
      dir: params.get(`${id}dir`) === 'asc' ? 'asc' : params.get(`${id}dir`) === 'desc' ? 'desc' : d.dir,
      q: id === 'c' ? params.get('cq') || undefined : undefined,
    };
  }, [params]);

  const setTable = useCallback((id: TableId, patch: { page?: number; sort?: string; dir?: 'asc' | 'desc'; q?: string }) => {
    const next = new URLSearchParams(params);
    const set = (key: string, value: string | undefined) => (value ? next.set(key, value) : next.delete(key));
    if (patch.sort !== undefined) {
      set(`${id}sort`, patch.sort);
      set(`${id}dir`, patch.dir);
      next.delete(`${id}page`);
    }
    if (patch.q !== undefined) {
      set('cq', patch.q || undefined);
      next.delete(`${id}page`);
    }
    if (patch.page !== undefined) set(`${id}page`, patch.page > 1 ? String(patch.page) : undefined);
    setParams(next);
  }, [params, setParams]);

  return { filters, filtersKey, setFilters, clearFilters, table, setTable, params };
}

/**
 * Loads one thing, cancelling the request when its inputs change or the page goes away. Errors are kept, never swallowed.
 * `loading` is derived (the last settled request is not the current one), so the effect only sets state from the response.
 * The previous data stays visible while the next request runs.
 */
export function useReportData<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  // Kept current after every render so the loading effect below always calls the latest closure.
  useEffect(() => { loadRef.current = load; });
  const key = `${attempt}|${JSON.stringify(deps)}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loadRef.current(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ key, data, error: null }); })
      .catch((err: any) => {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
        const first = err?.response?.data?.errors?.[0];
        const message = first ? `${first.field}: ${first.message}` : err?.response?.data?.message || err?.message || 'Could not load this section';
        setResult({ key, data: null, error: String(message) });
      });
    return () => controller.abort();
  }, [key, enabled]);

  if (!enabled) return { data: null as T | null, loading: false, error: null as string | null, retry: () => setAttempt((n) => n + 1) };
  const settled = result.key === key;
  return {
    data: result.data,
    loading: !settled,
    // A failure belongs to the request that failed; once the inputs change the old message goes away.
    error: settled ? result.error : null,
    retry: () => setAttempt((n) => n + 1),
  };
}
