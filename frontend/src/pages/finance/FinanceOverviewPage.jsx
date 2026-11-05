import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Box, Button, Chip, Grid, LinearProgress, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import BarChart from '../../components/BarChart';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS } from '../../utils/payments';
import { ACCOUNTS, MONEY_KINDS } from '../../utils/finance';
import { downloadCsv } from '../../utils/csv';
import { CsvButton, DateRangeBar, PRESETS, ReportTable } from '../reports/ReportParts';

const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    body * { visibility: hidden !important; }
    #finance, #finance * { visibility: visible !important; }
    #finance { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
  }
`;

const shortDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// Every day in the range, so quiet days show as empty bars.
function fillDays(from, to, rows, field) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const [y, m, d] = from.split('-').map(Number);
  for (let dt = new Date(y, m - 1, d); ; dt.setDate(dt.getDate() + 1)) {
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (key > to || out.length > 400) break;
    out.push({ key, label: shortDay(key), value: byDay.get(key)?.[field] ?? 0 });
  }
  return out;
}

const round = (v) => formatAmount(Math.round(v));
const share = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function ChartCard({ title, data, onCsv }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '28px', p: 2.5, mb: 2.5, breakInside: 'avoid' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        <CsvButton onClick={onCsv} />
      </Box>
      <BarChart data={data} format={(v) => formatMoney(v)} emptyText="No money moved in this period" />
    </Box>
  );
}

function FinanceView({ data }) {
  const t = data.totals;
  const b = data.balances;
  const o = data.outstanding;
  const file = (name) => `${name}_${data.from}_${data.to}.csv`;
  const daysIn = fillDays(data.from, data.to, data.by_day, 'money_in');
  const daysOut = fillDays(data.from, data.to, data.by_day, 'money_out');
  const dayCsv = (label, rows) => () => downloadCsv(file(label), [{ label: 'Date', value: (r) => r.key }, { label: 'Amount', value: (r) => r.value }], rows);

  const outRows = [
    { key: 'supplier', label: 'Supplier payments', count: t.counts.supplier_payments, amount: t.supplier_payments },
    { key: 'craftsman', label: 'Craftsman payments', count: t.counts.craftsman_payments, amount: t.craftsman_payments },
    { key: 'expense', label: 'Shop expenses', count: t.counts.expenses, amount: t.expenses },
  ];
  const ownerRows = [
    { key: 'opening', label: 'Opening balances', amount: t.opening },
    { key: 'capital', label: 'Capital put in by owner', amount: t.capital_in },
    { key: 'drawing', label: 'Drawings taken by owner', amount: -t.drawings },
  ].filter((r) => r.amount !== 0);
  const outstandingRows = [
    { key: 'rec', label: 'Customers owe the shop', amount: o.receivables },
    { key: 'pay', label: 'Shop owes suppliers', amount: o.payables },
    { key: 'cm', label: 'Shop owes craftsmen (fees)', amount: o.craftsman_due },
  ];

  return (
    <>
      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>In this period</Typography>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard tone="gold" label="Money in" note={`${t.counts.receipts} customer receipt(s)`} value={round(t.money_in)} to="/customer-payments" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard tone="light" label="Money out" note="Suppliers, craftsmen and expenses" value={round(t.money_out)} to="/expenses" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard tone="gray" label="Net cash flow" note={t.net > 0 ? 'More came in than went out' : t.net < 0 ? 'More went out than came in' : 'In and out are equal'} value={round(t.net)} />
        </Grid>
      </Grid>

      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Right now</Typography>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label={ACCOUNTS.cash} note="Paid / received in cash" value={round(b.cash)} to="/cash-bank" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label={ACCOUNTS.bank} note="Card, transfer and cheque" value={round(b.bank)} to="/cash-bank" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="To receive" note="Customers owe the shop" value={round(o.receivables)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="To pay" note="Suppliers + craftsmen" value={round(o.payables + o.craftsman_due)} /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}><ChartCard title="Money in per day" data={daysIn} onCsv={dayCsv('money_in_by_day', daysIn)} /></Grid>
        <Grid size={{ xs: 12, lg: 6 }}><ChartCard title="Money out per day" data={daysOut} onCsv={dayCsv('money_out_by_day', daysOut)} /></Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="Where the money went"
            rows={outRows}
            columns={[
              { label: 'Paid for', render: (r) => r.label },
              { label: 'Entries', align: 'right', render: (r) => r.count },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
              { label: 'Share', align: 'right', render: (r) => share(r.amount, t.money_out) },
            ]}
            footer={['Total', '', formatMoney(t.money_out), '']}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="By payment method"
            rows={data.by_method}
            columns={[
              { label: 'Method', render: (r) => PAYMENT_METHODS[r.label] || r.label },
              { label: 'In', align: 'right', render: (r) => formatMoney(r.money_in) },
              { label: 'Out', align: 'right', render: (r) => formatMoney(r.money_out) },
              { label: 'Net', align: 'right', render: (r) => formatMoney(r.money_in - r.money_out) },
            ]}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="Expenses by category"
            rows={data.expenses_by_category}
            empty="No expenses in this period"
            columns={[
              { label: 'Category', render: (r) => r.label },
              { label: 'Entries', align: 'right', render: (r) => r.count },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
              { label: 'Share', align: 'right', render: (r) => share(r.amount, t.expenses) },
            ]}
            footer={['Total', '', formatMoney(t.expenses), '']}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="Outstanding (right now)"
            rows={outstandingRows}
            columns={[
              { label: 'Who', render: (r) => r.label },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]}
          />
          {ownerRows.length > 0 && (
            <ReportTable
              title="Owner and opening money (not counted as money in / out)"
              rows={ownerRows}
              columns={[
                { label: 'Entry', render: (r) => r.label },
                { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
              ]}
            />
          )}
        </Grid>
      </Grid>

      <ReportTable
        title="All money movements"
        rows={data.recent}
        empty="No money moved in this period"
        columns={[
          { label: 'Date', nowrap: true, render: (r) => formatDate(r.txn_date) },
          { label: 'Type', render: (r) => <Chip size="small" variant="outlined" label={MONEY_KINDS[r.kind]?.label || r.kind} color={MONEY_KINDS[r.kind]?.color || 'default'} /> },
          { label: 'Ref', nowrap: true, render: (r) => r.ref_no },
          { label: 'Party / note', render: (r) => r.party || '—' },
          { label: 'Account', render: (r) => `${ACCOUNTS[r.account]}${r.method && r.method !== 'cash' ? ` · ${PAYMENT_METHODS[r.method]}` : ''}` },
          { label: 'In', align: 'right', render: (r) => (r.direction > 0 ? formatMoney(r.amount) : '') },
          { label: 'Out', align: 'right', render: (r) => (r.direction < 0 ? formatMoney(r.amount) : '') },
        ]}
        onCsv={() => downloadCsv(file('money_movements'), [
          { label: 'Date', value: (r) => r.txn_date },
          { label: 'Type', value: (r) => MONEY_KINDS[r.kind]?.label || r.kind },
          { label: 'Ref', value: (r) => r.ref_no },
          { label: 'Party / note', value: (r) => r.party },
          { label: 'Account', value: (r) => ACCOUNTS[r.account] },
          { label: 'Method', value: (r) => (r.method ? PAYMENT_METHODS[r.method] : '') },
          { label: 'In', value: (r) => (r.direction > 0 ? r.amount : '') },
          { label: 'Out', value: (r) => (r.direction < 0 ? r.amount : '') },
        ], data.recent)}
      />
    </>
  );
}

export default function FinanceOverviewPage() {
  const { can } = useAuth();
  const [range, setRange] = useState(() => {
    const [from, to] = PRESETS.find((p) => p.key === 'month').range();
    return { from, to };
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get('/finance/overview', { params: range })
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [range]);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Finance"
        subtitle="All money coming in and going out of the shop"
        actions={(
          <Box className="no-print" sx={{ display: 'flex', gap: 1 }}>
            {can('expenses.view') && <Button variant="outlined" component={Link} to="/expenses">Expenses</Button>}
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()} disabled={!data}>Print</Button>
          </Box>
        )}
      />
      <DateRangeBar range={range} onChange={setRange} />
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box id="finance">
        <Typography sx={{ display: 'none', '@media print': { display: 'block' }, fontWeight: 700, fontSize: 20, mb: 2 }}>
          Finance · {formatDate(range.from)} – {formatDate(range.to)}
        </Typography>
        {data && <FinanceView data={data} />}
      </Box>
    </>
  );
}
