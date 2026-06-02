const currencySymbols: Record<string, string> = {
  NGN: '\u20A6',
  USD: '$',
  GBP: '\u00A3',
  EUR: '\u20AC',
  CAD: 'C$',
  CNY: '\u00A5',
  Yuan: '\u00A5',
};

export function formatCurrency(amount: number | null | undefined, currency: string = 'NGN'): string {
  const symbol = currencySymbols[currency] || currency;
  if (amount == null) return `${symbol}0.00`;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}
