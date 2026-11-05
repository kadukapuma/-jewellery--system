import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, LinearProgress, Tab, Tabs, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import { formatDate } from '../../utils/format';
import { DateRangeBar, PRESETS } from './ReportParts';
import SalesReport from './SalesReport';
import ProfitReport from './ProfitReport';
import StockReport from './StockReport';
import WastageReport from './WastageReport';
import BalancesReport from './BalancesReport';

const REPORTS = [
  { key: 'sales', label: 'Sales', perms: ['reports.sales'], dated: true, Component: SalesReport },
  { key: 'profit', label: 'Profit', perms: ['reports.profit'], dated: true, Component: ProfitReport },
  { key: 'stock', label: 'Stock', perms: ['reports.stock'], dated: false, Component: StockReport },
  { key: 'wastage', label: 'Wastage', perms: ['reports.wastage'], dated: true, Component: WastageReport },
  { key: 'balances', label: 'Balances', perms: ['reports.customer_balances', 'reports.supplier_balances', 'reports.craftsman_balances'], dated: false, Component: BalancesReport },
];

const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    body * { visibility: hidden !important; }
    #report, #report * { visibility: visible !important; }
    #report { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
  }
`;

export default function ReportsPage() {
  const { can } = useAuth();
  const allowed = useMemo(() => REPORTS.filter((r) => can(...r.perms)), [can]);
  const [params, setParams] = useSearchParams();
  const current = allowed.find((r) => r.key === params.get('r')) || allowed[0];
  const [range, setRange] = useState(() => {
    const [from, to] = PRESETS.find((p) => p.key === 'month').range();
    return { from, to };
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!current) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    api
      .get(`/reports/${current.key}`, { params: current.dated ? range : {} })
      .then((res) => active && setData({ key: current.key, report: res.data }))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [current, range]);

  if (!current) return <Alert severity="info">You do not have access to any reports.</Alert>;
  const { Component } = current;
  // Only show data fetched for the selected tab; right after a tab switch it still holds the previous report.
  const report = data?.key === current.key ? data.report : null;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Reports"
        subtitle="Sales, profit, stock, wastage and balances"
        actions={<Button className="no-print" variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()} disabled={!report}>Print</Button>}
      />
      <Tabs className="no-print" value={current.key} onChange={(e, v) => setParams({ r: v })} variant="scrollable" sx={{ mb: 2 }}>
        {allowed.map((r) => <Tab key={r.key} value={r.key} label={r.label} />)}
      </Tabs>
      {current.dated && <DateRangeBar range={range} onChange={setRange} />}
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box id="report">
        <Typography sx={{ display: 'none', '@media print': { display: 'block' }, fontWeight: 700, fontSize: 20, mb: 2 }}>
          {current.label} report{current.dated ? ` · ${formatDate(range.from)} – ${formatDate(range.to)}` : ` · ${formatDate(new Date().toISOString().slice(0, 10))}`}
        </Typography>
        {report && <Component data={report} />}
      </Box>
    </>
  );
}
