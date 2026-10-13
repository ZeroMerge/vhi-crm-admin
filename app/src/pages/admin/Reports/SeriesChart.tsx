import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compactNumber } from './format';

// Two-series bar chart per period. Series are told apart by colour AND texture (solid vs hatched), both are in the legend, and
// the same numbers are one click away as a table whose period cells are real links. Bars are keyboard-focusable links too.
// Palette checked with the dataviz validator (light surface): purple #7B2D8B + orange #D9730D, CVD separation dE 30.

export const SERIES_A = '#7B2D8B';
export const SERIES_B = '#D9730D';

export interface ChartPoint {
  key: string;
  label: string;
  /** Number for the bar height only; the exact figures are the *Text fields. */
  a: number;
  b: number;
  aText: string;
  bText: string;
  hrefA: string;
  hrefB: string;
  partial: boolean;
}

interface Props {
  title: string;
  seriesA: string;
  seriesB: string;
  points: ChartPoint[];
  axisFormat?: (n: number) => string;
  /** Plain-language summary for screen readers. */
  summary: string;
}

const shortTick = (label: string) => (/^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label);

function barShape(series: 'a' | 'b', fillId: string, color: string, name: string, onOpen: (href: string) => void) {
  return function Shape(props: any) {
    const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: ChartPoint };
    if (!height || height <= 0 || !width) return <g />;
    const href = series === 'a' ? payload.hrefA : payload.hrefB;
    const text = series === 'a' ? payload.aText : payload.bText;
    const open = () => onOpen(href);
    return (
      <g
        className="rpt-bar" role="link" tabIndex={0}
        aria-label={`${payload.label}${payload.partial ? ' (partial period)' : ''}: ${name} ${text}. Open the list.`}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      >
        <rect x={x} y={y} width={width} height={height} rx={2} fill={series === 'b' ? `url(#${fillId})` : color} stroke={color} strokeWidth={1.5} />
      </g>
    );
  };
}

export function SeriesChart({ title, seriesA, seriesB, points, axisFormat = compactNumber, summary }: Props) {
  const navigate = useNavigate();
  const uid = useId().replace(/:/g, '');
  const hatch = `rpt-hatch-${uid}`;
  const [asTable, setAsTable] = useState(false);
  const empty = points.every((p) => p.a === 0 && p.b === 0);

  return (
    <div className="rpt-panel">
      <div className="rpt-panel-head">
        <h3>{title}</h3>
        <div className="rpt-legend" aria-label="Legend">
          <span><svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="2" fill={SERIES_A} /></svg>{seriesA}</span>
          <span>
            <svg width="14" height="14" aria-hidden="true">
              <defs><pattern id={`${hatch}-legend`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff" /><rect width="2.5" height="5" fill={SERIES_B} /></pattern></defs>
              <rect width="14" height="14" rx="2" fill={`url(#${hatch}-legend)`} stroke={SERIES_B} strokeWidth="1.5" />
            </svg>
            {seriesB}
          </span>
        </div>
        <button type="button" className="btn btn-outline btn-sm" aria-expanded={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <caption className="rpt-sr-only">{title}</caption>
            <thead><tr><th scope="col">Period</th><th scope="col" className="num">{seriesA}</th><th scope="col" className="num">{seriesB}</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <th scope="row" style={{ background: 'transparent', color: 'inherit' }}>{p.label}{p.partial ? ' (partial)' : ''}</th>
                  <td className="num"><Link to={p.hrefA}>{p.aText}</Link></td>
                  <td className="num"><Link to={p.hrefB}>{p.bText}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <div className="rpt-state">Nothing to chart for these filters.</div>
      ) : (
        <div role="group" aria-label={`${title}. ${summary} Use "View as table" for every value.`} style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <defs>
                <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="#fff" /><rect width="3" height="6" fill={SERIES_B} />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="label" tickFormatter={shortTick} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={{ stroke: '#D1D5DB' }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tickFormatter={axisFormat} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(123,45,139,0.06)' }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload as ChartPoint | undefined;
                  if (!p) return null;
                  return (
                    <div className="rpt-tooltip">
                      <strong>{p.label}{p.partial ? ' (partial)' : ''}</strong>
                      <div>{seriesA}: {p.aText}</div>
                      <div>{seriesB}: {p.bText}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="a" name={seriesA} isAnimationActive={false} shape={barShape('a', hatch, SERIES_A, seriesA, navigate)} />
              <Bar dataKey="b" name={seriesB} isAnimationActive={false} shape={barShape('b', hatch, SERIES_B, seriesB, navigate)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
