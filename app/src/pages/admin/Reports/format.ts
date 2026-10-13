const SYMBOLS: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "₦1,234.50" from the API's exact decimal text; no float arithmetic on the way. */
export function formatMoneyText(amount: string | null | undefined, currency: string): string {
  const text = amount && /^-?\d+(\.\d+)?$/.test(amount) ? amount : '0.00';
  const negative = text.startsWith('-');
  const [int, frac = '00'] = text.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = SYMBOLS[currency];
  return `${negative ? '-' : ''}${symbol ?? `${currency} `}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** Short money for chart axes only ("1.2M"): never shown as a figure. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

export const formatInt = (n: number) => n.toLocaleString('en-US');

/** "1 Oct 2026" from YYYY-MM-DD (a local date: no time zone maths). */
export function prettyDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ymd;
}

export const prettyRange = (from: string, to: string) => (from === to ? prettyDate(from) : `${prettyDate(from)} to ${prettyDate(to)}`);

export const humanize = (value: string | null | undefined, empty = 'Not set') =>
  value ? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : empty;
