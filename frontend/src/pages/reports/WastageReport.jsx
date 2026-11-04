import { Grid, Typography } from '@mui/material';
import StatCard from '../../components/StatCard';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { downloadCsv } from '../../utils/csv';
import { ReportTable } from './ReportParts';

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export default function WastageReport({ data }) {
  const t = data.totals;
  const file = (name) => `${name}_${data.from}_${data.to}.csv`;
  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Jobs received" value={t.jobs} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Gold given" value={formatAmount(t.issued_g)} unit="g" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label="Wastage" note="Charged to customers on the bill" value={formatAmount(t.wastage_g)} unit="g" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gray" label="Average wastage" value={t.wastage_percent ?? '—'} unit={t.wastage_percent === null ? undefined : '%'} /></Grid>
      </Grid>
      <ReportTable
        title="By craftsman"
        rows={data.by_craftsman}
        columns={[
          { label: 'Craftsman', render: (r) => r.name },
          { label: 'Jobs', align: 'right', render: (r) => r.jobs },
          { label: 'Gold given', align: 'right', nowrap: true, render: (r) => formatWeight(r.issued_g) },
          { label: 'Pieces back', align: 'right', nowrap: true, render: (r) => formatWeight(r.returned_g) },
          { label: 'Wastage', align: 'right', nowrap: true, render: (r) => formatWeight(r.wastage_g) },
          { label: 'Wastage %', align: 'right', render: (r) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{pct(r.wastage_percent)}</Typography> },
          { label: 'Avg. days', align: 'right', render: (r) => r.avg_days ?? '—' },
          { label: 'Fees', align: 'right', render: (r) => formatMoney(r.fees) },
        ]}
        onCsv={() => downloadCsv(file('wastage_by_craftsman'), [
          { label: 'Craftsman', value: (r) => r.name }, { label: 'Jobs', value: (r) => r.jobs }, { label: 'Gold given (g)', value: (r) => r.issued_g },
          { label: 'Pieces back (g)', value: (r) => r.returned_g }, { label: 'Wastage (g)', value: (r) => r.wastage_g },
          { label: 'Wastage %', value: (r) => r.wastage_percent }, { label: 'Avg days', value: (r) => r.avg_days }, { label: 'Fees', value: (r) => r.fees },
        ], data.by_craftsman)}
      />
      <ReportTable
        title="Every job received"
        maxHeight={480}
        rows={data.jobs}
        columns={[
          { label: 'Received', nowrap: true, render: (r) => formatDate(r.completed_date) },
          { label: 'Job', render: (r) => r.job_no },
          { label: 'Craftsman', render: (r) => r.craftsman },
          { label: 'Piece', render: (r) => `${r.description || r.category} · ${r.karat}` },
          { label: 'Given', align: 'right', nowrap: true, render: (r) => formatWeight(r.issued_weight_g) },
          { label: 'Back', align: 'right', nowrap: true, render: (r) => formatWeight(r.returned_weight_g) },
          { label: 'Wastage', align: 'right', nowrap: true, render: (r) => `${formatWeight(r.wastage_g)} (${pct(r.wastage_percent)})` },
        ]}
        onCsv={() => downloadCsv(file('craft_jobs'), [
          { label: 'Received', value: (r) => r.completed_date }, { label: 'Job', value: (r) => r.job_no }, { label: 'Craftsman', value: (r) => r.craftsman },
          { label: 'Piece', value: (r) => r.description || r.category }, { label: 'Karat', value: (r) => r.karat },
          { label: 'Given (g)', value: (r) => r.issued_weight_g }, { label: 'Back (g)', value: (r) => r.returned_weight_g },
          { label: 'Wastage (g)', value: (r) => r.wastage_g }, { label: 'Wastage %', value: (r) => r.wastage_percent },
        ], data.jobs)}
      />
    </>
  );
}
