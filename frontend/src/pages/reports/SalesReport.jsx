import { Box, Grid, Typography } from '@mui/material';
import StatCard from '../../components/StatCard';
import BarChart from '../../components/BarChart';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS } from '../../utils/payments';
import { downloadCsv } from '../../utils/csv';
import { ReportTable, CsvButton } from './ReportParts';

const shortDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// Every day in the range, so days without sales show as empty bars.
function fillDays(from, to, rows) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const [y, m, d] = from.split('-').map(Number);
  for (let dt = new Date(y, m - 1, d); ; dt.setDate(dt.getDate() + 1)) {
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (key > to || out.length > 400) break;
    const r = byDay.get(key);
    out.push({ key, label: shortDay(key), value: r ? Number(r.total) : 0, detail: r ? `${r.bills} bill(s)` : 'No sales' });
  }
  return out;
}

export default function SalesReport({ data }) {
  const t = data.totals;
  const days = fillDays(data.from, data.to, data.by_day);
  const file = (name) => `${name}_${data.from}_${data.to}.csv`;
  const breakdown = (title, rows, key) => (
    <ReportTable
      title={title}
      rows={rows}
      columns={[
        { label: key, render: (r) => r.label },
        { label: 'Pieces', align: 'right', render: (r) => r.pieces },
        { label: 'Billed weight', align: 'right', nowrap: true, render: (r) => formatWeight(r.weight_g) },
        { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
      ]}
      onCsv={() => downloadCsv(file(`sales_by_${key.toLowerCase()}`), [
        { label: key, value: (r) => r.label }, { label: 'Pieces', value: (r) => r.pieces },
        { label: 'Billed weight (g)', value: (r) => r.weight_g }, { label: 'Amount', value: (r) => r.amount },
      ], rows)}
    />
  );

  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label="Sales" note={`${t.bills} bill(s)${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}`} value={formatAmount(Math.round(t.total))} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Gold sold" note={`${t.pieces} pcs · ${formatWeight(t.wastage_g)} wastage`} value={formatAmount(t.billed_g)} unit="g" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Making charges" note={`Discounts ${formatMoney(t.discount)}`} value={formatAmount(Math.round(t.making))} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gray" label="Still on credit" note="From these bills" value={formatAmount(Math.round(t.on_credit))} /></Grid>
      </Grid>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '28px', p: 2.5, mb: 2.5, breakInside: 'avoid' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>Sales per day</Typography>
          <CsvButton onClick={() => downloadCsv(file('sales_by_day'), [
            { label: 'Date', value: (r) => r.key }, { label: 'Sales', value: (r) => r.value }, { label: 'Bills', value: (r) => r.detail },
          ], days)} />
        </Box>
        <BarChart data={days} format={(v) => formatMoney(v)} />
      </Box>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>{breakdown('By karat', data.by_karat, 'Karat')}</Grid>
        <Grid size={{ xs: 12, lg: 6 }}>{breakdown('By category', data.by_category, 'Category')}</Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="Money received, by payment method"
            rows={data.by_method}
            columns={[
              { label: 'Method', render: (r) => PAYMENT_METHODS[r.label] },
              { label: 'Receipts', align: 'right', render: (r) => r.receipts },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]}
            footer={['Total', data.by_method.reduce((s, r) => s + r.receipts, 0), formatMoney(data.by_method.reduce((s, r) => s + r.amount, 0))]}
            onCsv={() => downloadCsv(file('money_received'), [
              { label: 'Method', value: (r) => PAYMENT_METHODS[r.label] }, { label: 'Receipts', value: (r) => r.receipts }, { label: 'Amount', value: (r) => r.amount },
            ], data.by_method)}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ReportTable
            title="By cashier"
            rows={data.by_cashier}
            columns={[
              { label: 'Cashier', render: (r) => r.label },
              { label: 'Bills', align: 'right', render: (r) => r.bills },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]}
          />
        </Grid>
      </Grid>
      <Typography variant="caption" color="text.secondary">
        {formatDate(data.from)} – {formatDate(data.to)}. Sales count bills made in the period; money received counts every receipt in the period, including payments for older bills.
      </Typography>
    </>
  );
}
