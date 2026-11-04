import { Alert, Grid, Typography } from '@mui/material';
import StatCard from '../../components/StatCard';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { downloadCsv } from '../../utils/csv';
import { ReportTable } from './ReportParts';

const money = (v) => (
  <Typography component="span" variant="body2" sx={{ color: v < 0 ? 'error.main' : undefined, fontWeight: 600 }}>{formatMoney(v)}</Typography>
);

export default function ProfitReport({ data }) {
  const t = data.totals;
  const file = (name) => `${name}_${data.from}_${data.to}.csv`;
  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Sales (after discount)" value={formatAmount(Math.round(t.revenue))} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Cost of items sold" value={formatAmount(Math.round(t.cost))} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label="Gross profit" value={formatAmount(Math.round(t.profit))} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gray" label="Margin" value={t.margin_percent === null ? '—' : t.margin_percent} unit={t.margin_percent === null ? undefined : '%'} /></Grid>
      </Grid>
      {t.lines_without_cost > 0 && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          {t.lines_without_cost} sold item(s) have no cost price, so their whole price counts as profit. Set the cost price on items entered as opening stock.
        </Alert>
      )}
      <ReportTable
        title="By category"
        rows={data.by_category}
        columns={[
          { label: 'Category', render: (r) => r.label },
          { label: 'Pieces', align: 'right', render: (r) => r.pieces },
          { label: 'Sales', align: 'right', render: (r) => formatMoney(r.revenue) },
          { label: 'Cost', align: 'right', render: (r) => formatMoney(r.cost) },
          { label: 'Profit', align: 'right', render: (r) => money(r.profit) },
        ]}
        footer={['Total', data.by_category.reduce((s, r) => s + r.pieces, 0), formatMoney(t.revenue), formatMoney(t.cost), formatMoney(t.profit)]}
      />
      <ReportTable
        title="Every item sold"
        maxHeight={520}
        rows={data.lines.map((l, i) => ({ ...l, key: i }))}
        columns={[
          { label: 'Date', nowrap: true, render: (r) => formatDate(r.sale_date) },
          { label: 'Bill', render: (r) => r.invoice_no },
          { label: 'Item', render: (r) => `${r.item_code} · ${r.item_name}${r.qty > 1 ? ` × ${r.qty}` : ''}` },
          { label: 'Weight', align: 'right', nowrap: true, render: (r) => formatWeight(r.billed_weight_g) },
          { label: 'Sales', align: 'right', render: (r) => formatMoney(r.revenue) },
          { label: 'Cost', align: 'right', render: (r) => (r.no_cost ? <Typography variant="body2" color="warning.main">not set</Typography> : formatMoney(r.cost)) },
          { label: 'Profit', align: 'right', render: (r) => money(r.profit) },
        ]}
        onCsv={() => downloadCsv(file('profit_by_item'), [
          { label: 'Date', value: (r) => r.sale_date }, { label: 'Bill', value: (r) => r.invoice_no }, { label: 'Item code', value: (r) => r.item_code },
          { label: 'Item', value: (r) => r.item_name }, { label: 'Category', value: (r) => r.category }, { label: 'Qty', value: (r) => r.qty },
          { label: 'Billed weight (g)', value: (r) => r.billed_weight_g }, { label: 'Sales', value: (r) => r.revenue },
          { label: 'Cost', value: (r) => r.cost }, { label: 'Profit', value: (r) => r.profit },
        ], data.lines)}
      />
      <Typography variant="caption" color="text.secondary">
        Cost = what the shop paid (purchase price, or gold + craftsman fee for made items), recorded when the item was sold. Bill discounts are shared across the bill's items.
      </Typography>
    </>
  );
}
