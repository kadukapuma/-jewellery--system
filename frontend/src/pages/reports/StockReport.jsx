import { Chip, Grid, Typography } from '@mui/material';
import StatCard from '../../components/StatCard';
import { formatAmount, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { downloadCsv } from '../../utils/csv';
import { todayYmd } from '../../utils/payments';
import { ReportTable } from './ReportParts';

export default function StockReport({ data }) {
  const t = data.totals;
  const showCost = t.cost !== undefined;
  const columns = [
    { label: 'Category', render: (r) => r.category },
    { label: 'Karat', render: (r) => r.karat },
    { label: 'Pieces', align: 'right', render: (r) => r.pieces },
    { label: 'Gold weight', align: 'right', nowrap: true, render: (r) => formatWeight(r.net_g) },
    ...(showCost ? [{ label: 'Cost', align: 'right', render: (r) => formatMoney(r.cost) }] : []),
    { label: 'Value today', align: 'right', render: (r) => (r.without_price ? <Typography variant="body2" color="warning.main">no gold price</Typography> : formatMoney(r.value_now)) },
  ];
  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label="Pieces in stock" value={formatAmount(t.pieces)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Gold in stock" value={formatAmount(t.net_g)} unit="g" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard tone="light" label="Value at today’s price" note={showCost ? `Cost ${formatMoney(t.cost)}` : undefined} value={formatAmount(Math.round(t.value_now))} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gray" label="Gold with craftsmen" note="Not in the shop" value={formatAmount(t.gold_with_craftsmen_g)} unit="g" to="/craftsmen" /></Grid>
      </Grid>
      <ReportTable
        title="Stock by category and karat"
        rows={data.groups.map((g) => ({ ...g, key: `${g.category}-${g.karat}` }))}
        columns={columns}
        empty="Nothing in stock"
        footer={['Total', '', t.pieces, formatWeight(t.net_g), ...(showCost ? [formatMoney(t.cost)] : []), formatMoney(t.value_now)]}
        onCsv={() => downloadCsv(`stock_${todayYmd()}.csv`, [
          { label: 'Category', value: (r) => r.category }, { label: 'Karat', value: (r) => r.karat }, { label: 'Pieces', value: (r) => r.pieces },
          { label: 'Gold weight (g)', value: (r) => r.net_g }, ...(showCost ? [{ label: 'Cost', value: (r) => r.cost }] : []),
          { label: 'Value today', value: (r) => r.value_now },
        ], data.groups)}
      />
      <ReportTable
        title="Needs attention: slow-moving (90+ days) or no tag printed"
        maxHeight={480}
        rows={data.slow_or_untagged}
        empty="Nothing – every item is tagged and moving"
        columns={[
          { label: 'Code', render: (r) => r.item_code },
          { label: 'Item', render: (r) => r.name },
          { label: 'Category', render: (r) => r.category },
          { label: 'Karat', render: (r) => r.karat },
          { label: 'Weight', align: 'right', nowrap: true, render: (r) => formatWeight(r.net_weight_g) },
          { label: 'Days in stock', align: 'right', render: (r) => r.days_in_stock },
          {
            label: 'Why', render: (r) => (
              <>
                {r.slow && <Chip size="small" color="warning" variant="outlined" label="Slow" sx={{ mr: 0.5 }} />}
                {r.untagged && <Chip size="small" variant="outlined" label="No tag" />}
              </>
            ),
          },
        ]}
        onCsv={() => downloadCsv(`stock_attention_${todayYmd()}.csv`, [
          { label: 'Code', value: (r) => r.item_code }, { label: 'Item', value: (r) => r.name }, { label: 'Category', value: (r) => r.category },
          { label: 'Karat', value: (r) => r.karat }, { label: 'Weight (g)', value: (r) => r.net_weight_g }, { label: 'Days in stock', value: (r) => r.days_in_stock },
          { label: 'Slow', value: (r) => (r.slow ? 'yes' : '') }, { label: 'No tag', value: (r) => (r.untagged ? 'yes' : '') },
        ], data.slow_or_untagged)}
      />
    </>
  );
}
