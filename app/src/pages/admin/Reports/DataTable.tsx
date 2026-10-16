import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { ListParams } from '@/services/report.service';
import { formatInt } from './format';

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  /** Server sort key; omit for columns that cannot be sorted. */
  sort?: string;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[] | null;
  total: number;
  list: ListParams;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSort: (sort: string, dir: 'asc' | 'desc') => void;
  onPage: (page: number) => void;
  rowKey: (row: T) => string;
  /** Where clicking the row (outside a link) goes. */
  rowHref?: (row: T) => string | null;
  search?: { value: string; onSearch: (q: string) => void; label: string };
  emptyText?: string;
}

export function DataTable<T>({ caption, columns, rows, total, list, loading, error, onRetry, onSort, onPage, rowKey, rowHref, search, emptyText }: Props<T>) {
  const navigate = useNavigate();
  const pageSize = list.pageSize ?? 25;
  const page = list.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {search && (
        <form role="search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q'); search.onSearch(String(q ?? '').trim()); }} style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
          <label className="rpt-sr-only" htmlFor={`${caption}-search`}>{search.label}</label>
          <input id={`${caption}-search`} name="q" key={search.value} className="rpt-input" type="search" defaultValue={search.value} placeholder={search.label} maxLength={100} />
          <button type="submit" className="btn btn-outline btn-sm"><Search size={14} aria-hidden="true" /> Search</button>
        </form>
      )}

      {error ? (
        <div className="rpt-error" role="alert"><span>{error}</span><button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Try again</button></div>
      ) : (
        <div className="rpt-table-wrap" aria-busy={loading}>
          <table className="rpt-table">
            <caption className="rpt-sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = c.sort && list.sort === c.sort;
                  const nextDir = active && list.dir === 'asc' ? 'desc' : 'asc';
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined} aria-sort={active ? (list.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sort ? (
                        <button type="button" onClick={() => onSort(c.sort!, nextDir)} aria-label={`Sort by ${c.header}`}>
                          {c.header}{active ? (list.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
                        </button>
                      ) : c.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && !rows && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key}><div className="rpt-skel" style={{ height: 14, width: c.numeric ? 60 : 120 }} /></td>)}</tr>
              ))}
              {rows?.map((row) => {
                const href = rowHref?.(row) ?? null;
                return (
                  <tr key={rowKey(row)} className={href ? 'clickable' : undefined}
                    onClick={href ? (e) => { if (!(e.target as HTMLElement).closest('a,button')) navigate(href); } : undefined}>
                    {columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render(row)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && rows.length === 0 && !loading && <div className="rpt-state">{emptyText ?? 'No rows for these filters.'}</div>}
        </div>
      )}

      {!error && total > 0 && (
        <div className="rpt-pager">
          <span aria-live="polite">{formatInt(first)}-{formatInt(last)} of {formatInt(total)}</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" /></button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages || loading} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} aria-hidden="true" /></button>
          </span>
        </div>
      )}
    </div>
  );
}
