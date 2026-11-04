import { Grid, Typography } from '@mui/material';
import StatCard from '../../components/StatCard';
import { formatAmount, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { downloadCsv } from '../../utils/csv';
import { todayYmd } from '../../utils/payments';
import { ReportTable } from './ReportParts';

const AGES = [
  ['not_due', 'Not due'],
  ['d1_30', '1–30 days'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90_plus', '90+ days'],
];

const amount = (v) => (v ? formatMoney(v) : '—');

function AgeingTable({ title, rows, file }) {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] > 0 ? r[k] : 0), 0);
  return (
    <ReportTable
      title={title}
      rows={rows}
      empty="Nobody has a balance"
      columns={[
        { label: 'Name', render: (r) => <><Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography><Typography variant="caption" color="text.secondary">{r.phone}</Typography></> },
        { label: 'Balance', align: 'right', nowrap: true, render: (r) => (r.balance < 0 ? `${formatMoney(-r.balance)} adv.` : <b>{formatMoney(r.balance)}</b>) },
        ...AGES.map(([k, label]) => ({
          label, align: 'right', nowrap: true,
          render: (r) => <Typography variant="body2" sx={{ color: k === 'd90_plus' && r[k] > 0 ? 'error.main' : undefined }}>{amount(r[k])}</Typography>,
        })),
      ]}
      footer={['Total', formatMoney(sum('balance')), ...AGES.map(([k]) => formatMoney(sum(k)))]}
      onCsv={() => downloadCsv(`${file}_${todayYmd()}.csv`, [
        { label: 'Name', value: (r) => r.name }, { label: 'Phone', value: (r) => r.phone }, { label: 'Balance', value: (r) => r.balance },
        ...AGES.map(([k, label]) => ({ label, value: (r) => r[k] })),
      ], rows)}
    />
  );
}

export default function BalancesReport({ data }) {
  const owedToShop = (data.customers || []).reduce((s, r) => s + Math.max(0, r.balance), 0);
  const owedBySop = (data.suppliers || []).reduce((s, r) => s + Math.max(0, r.balance), 0);
  const goldOut = (data.craftsmen || []).reduce((s, r) => s + r.gold_held_g, 0);
  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {data.customers && <Grid size={{ xs: 12, sm: 4 }}><StatCard tone="gold" label="Customers owe you" value={formatAmount(Math.round(owedToShop))} to="/customers" /></Grid>}
        {data.suppliers && <Grid size={{ xs: 12, sm: 4 }}><StatCard tone="light" label="You owe suppliers" value={formatAmount(Math.round(owedBySop))} to="/suppliers" /></Grid>}
        {data.craftsmen && <Grid size={{ xs: 12, sm: 4 }}><StatCard tone="gray" label="Gold with craftsmen" value={formatAmount(Math.round(goldOut * 1000) / 1000)} unit="g" to="/craftsmen" /></Grid>}
      </Grid>
      {data.customers && <AgeingTable title="Customers – what they owe, by how late" rows={data.customers} file="customer_balances" />}
      {data.suppliers && <AgeingTable title="Suppliers – what you owe, by how late" rows={data.suppliers} file="supplier_balances" />}
      {data.craftsmen && (
        <ReportTable
          title="Craftsmen – gold held and fees owed"
          rows={data.craftsmen}
          empty="No craftsman holds gold or is owed fees"
          columns={[
            { label: 'Craftsman', render: (r) => r.name },
            { label: 'Jobs open', align: 'right', render: (r) => r.open_jobs },
            { label: 'Gold held', align: 'right', nowrap: true, render: (r) => formatWeight(r.gold_held_g) },
            { label: 'Fees owed', align: 'right', nowrap: true, render: (r) => (r.cash_due < 0 ? `${formatMoney(-r.cash_due)} adv.` : formatMoney(r.cash_due)) },
          ]}
          onCsv={() => downloadCsv(`craftsman_balances_${todayYmd()}.csv`, [
            { label: 'Craftsman', value: (r) => r.name }, { label: 'Jobs open', value: (r) => r.open_jobs },
            { label: 'Gold held (g)', value: (r) => r.gold_held_g }, { label: 'Fees owed', value: (r) => r.cash_due },
          ], data.craftsmen)}
        />
      )}
      <Typography variant="caption" color="text.secondary">Ageing counts days past each bill's or purchase's due date. Balances are as of today.</Typography>
    </>
  );
}
