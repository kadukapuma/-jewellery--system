import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Typography } from '@mui/material';
import api, { errorMessage } from '../../api/client';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { downloadCsv } from '../../utils/csv';
import { ReportTable } from '../reports/ReportParts';

const diffColor = (d) => (Math.abs(d) < 0.005 ? 'success.main' : d < 0 ? 'error.main' : 'warning.main');

// Every day that has been closed, newest first. "View" loads that day on the page.
export default function DayEndHistory({ reloadKey, onPick, showProfit }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/day-end/history', { params: { page_size: 200 } })
      .then((res) => active && setRows(res.data.closings))
      .catch((err) => active && setError(errorMessage(err)));
    return () => { active = false; };
  }, [reloadKey]);

  if (error) return <Alert severity="error">{error}</Alert>;

  const columns = [
    { label: 'Date', nowrap: true, render: (r) => formatDate(r.close_date) },
    { label: 'Status', render: (r) => (r.status === 'closed'
      ? <Chip size="small" color="success" variant="outlined" label="Closed" />
      : <Chip size="small" color="warning" variant="outlined" label="Re-opened" />) },
    { label: 'Bills', align: 'right', render: (r) => r.bills },
    { label: 'Sales', align: 'right', render: (r) => formatMoney(r.sales) },
    ...(showProfit ? [{ label: 'Net profit', align: 'right', render: (r) => (r.net_profit === null ? '—' : formatMoney(r.net_profit)) }] : []),
    { label: 'Expected cash', align: 'right', render: (r) => formatMoney(r.expected_cash) },
    { label: 'Counted', align: 'right', render: (r) => formatMoney(r.counted_cash) },
    { label: 'Short / over', align: 'right', render: (r) => <Typography component="span" sx={{ color: diffColor(r.cash_difference), fontWeight: 600, fontSize: 'inherit' }}>{formatMoney(r.cash_difference)}</Typography> },
    { label: 'Closed by', render: (r) => <>{r.closed_by_name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{formatDateTime(r.closed_at)}</Typography></> },
    { label: '', render: (r) => <Button size="small" className="no-print" onClick={() => onPick(r.close_date)}>View</Button> },
  ];

  return (
    <ReportTable
      title="Closed days"
      rows={rows}
      empty="No day has been closed yet"
      columns={columns}
      onCsv={() => downloadCsv('day_end_history.csv', [
        { label: 'Date', value: (r) => r.close_date },
        { label: 'Status', value: (r) => r.status },
        { label: 'Bills', value: (r) => r.bills },
        { label: 'Sales', value: (r) => r.sales },
        ...(showProfit ? [{ label: 'Net profit', value: (r) => r.net_profit ?? '' }] : []),
        { label: 'Opening cash', value: (r) => r.opening_cash },
        { label: 'Expected cash', value: (r) => r.expected_cash },
        { label: 'Counted cash', value: (r) => r.counted_cash },
        { label: 'Difference', value: (r) => r.cash_difference },
        { label: 'Closed by', value: (r) => r.closed_by_name },
        { label: 'Closed at', value: (r) => r.closed_at },
        { label: 'Notes', value: (r) => r.notes },
        { label: 'Re-open reason', value: (r) => r.reopen_reason },
      ], rows)}
    />
  );
}
