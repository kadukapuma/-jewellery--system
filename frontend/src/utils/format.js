// MySQL returns 'YYYY-MM-DD HH:MM:SS' strings; show them as local date/time.
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Money with 2 decimals: 12,500.00
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Money without trailing .00 for large headline numbers: 100,000 / 100,000.5
export function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '';
  return `${value > 0 ? '+' : ''}${value}%`;
}
