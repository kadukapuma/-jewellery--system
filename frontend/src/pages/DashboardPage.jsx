import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Grid, Skeleton, Typography,
} from '@mui/material';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import PurchaseIcon from '@mui/icons-material/ShoppingBagOutlined';
import WorkshopIcon from '@mui/icons-material/HandymanOutlined';
import CustomerIcon from '@mui/icons-material/GroupOutlined';
import PublicIcon from '@mui/icons-material/PublicOutlined';
import api, { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useNotify } from '../components/Notify';
import StatCard from '../components/StatCard';
import SectionCard from '../components/SectionCard';
import BarChart from '../components/BarChart';
import PriceHistoryChart from './pricing/PriceHistoryChart';
import { formatAmount, formatMoney } from '../utils/format';

const PRICE_TONES = ['gold', 'light', 'gray'];

function formatLiveTimestamp(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function DashboardPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [goldHistory, setGoldHistory] = useState([]);
  const [goldHistoryKarat, setGoldHistoryKarat] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/dashboard')
      .then((res) => active && setData(res.data))
      .catch((err) => active && notify(errorMessage(err), 'error'));
    return () => { active = false; };
  }, [notify]);

  const prices = data?.gold_prices?.prices || [];
  const missingToday = prices.filter((p) => !p.is_today);

  useEffect(() => {
    const karatId = prices[0]?.karat_id;
    if (!karatId) return undefined;
    let active = true;
    setGoldHistoryKarat(karatId);
    api.get('/gold-prices/history', { params: { karat_id: karatId, days: 30 } })
      .then((res) => active && setGoldHistory(res.data))
      .catch((err) => active && notify(errorMessage(err), 'error'));
    return () => { active = false; };
  }, [data, notify]);

  const priceCards = prices.slice(0, 3).map((p, i) => (
    <StatCard
      key={`price-${p.karat_id}`}
      tone={PRICE_TONES[i]}
      label={`${p.karat} · 1 pound`}
      value={p.pound_price !== null ? formatAmount(p.pound_price) : '—'}
      note={p.pound_price !== null ? `1 gram ${formatMoney(p.gram_price)}` : 'No price entered yet'}
      trend={p.change_percent}
      to="/gold-prices"
    />
  ));
  const sales = data?.sales;
  const salesChart = (sales?.daily || []).map((day) => ({
    key: day.day,
    label: new Date(`${day.day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }),
    value: day.amount,
    detail: `${day.bills} bill(s)`,
  }));
  const salesCards = sales ? [
    <StatCard key="sales-today" tone="gold" label="Sales today" note={`${sales.today_bills} bill(s) · ${formatAmount(Math.round(sales.today_paid))} received`}
      value={formatAmount(Math.round(sales.today_amount))} to="/sales" />,
    <StatCard key="owed" tone="light" label="Customers owe" note={`${sales.owed_bills} bill(s) on credit`}
      value={formatAmount(Math.round(sales.owed_amount))} to={can('customers.view') ? '/customers' : '/sales'} />,
    <StatCard key="overdue" tone="gray" label="Overdue" note="Past the due date"
      value={formatAmount(Math.round(sales.overdue_amount))} to="/sales" />,
  ] : [];
  const businessCards = [
    data?.inventory && (
      <StatCard key="inventory" tone="gold" label="Items in stock"
        note={`${formatAmount(data.inventory.weight_g)} g · ${formatAmount(data.inventory.with_craftsman)} with craftsman`}
        value={formatAmount(data.inventory.item_count)} to="/items" />
    ),
    data?.purchases && (
      <StatCard key="purchases" tone="light" label="Supplier balance"
        note={`${data.purchases.pending_count} unpaid purchase(s)`}
        value={formatAmount(Math.round(data.purchases.pending_amount))} to="/purchases" />
    ),
    data?.workshop && (
      <StatCard key="workshop" tone="gray" label="Workshop workload"
        note={`${formatAmount(data.workshop.issued_weight_g)} g issued · ${data.workshop.completed_today} completed today`}
        value={formatAmount(data.workshop.active_jobs)} to="/craft-jobs" />
    ),
  ].filter(Boolean);
  const [topCards = []] = [priceCards].filter((row) => row.length);
  const businessSummaryCards = [...salesCards, ...businessCards];

  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3, alignItems: 'stretch' }}>
        <Grid size={{ xs: 12, xl: 3 }} sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: { xs: 34, md: 44, xl: 46 }, fontWeight: 600, letterSpacing: { xs: -1, xl: -2 }, lineHeight: 1.05, overflowWrap: 'break-word' }}>
              Business<br />overview
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>Your jewellery business at a glance · {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Typography>
          </Box>
        </Grid>

        {!data && [0, 1, 2].map((i) => (
          <Grid key={i} size={{ xs: 12, sm: 4, xl: 3 }}><Skeleton variant="rounded" height={140} sx={{ borderRadius: '28px' }} /></Grid>
        ))}
        {topCards.map((card) => (
          <Grid key={card.key} size={{ xs: 12, sm: 4, xl: 3 }}>{card}</Grid>
        ))}
      </Grid>

      {missingToday.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={can('gold_prices.update') && <Button color="inherit" size="small" onClick={() => navigate('/gold-prices')}>Update prices</Button>}
        >
          Today's gold price is not entered yet for {missingToday.map((p) => p.karat).join(', ')}.
        </Alert>
      )}

      {(data?.live_gold || goldHistoryKarat) && (
        <Grid container spacing={2.5} sx={{ mb: 3, alignItems: 'stretch' }}>
          {data?.live_gold && (
          <Grid size={{ xs: 12, lg: 6 }} sx={{ display: 'flex', minWidth: 0 }}>
            <SectionCard icon={<PublicIcon fontSize="small" />} title="Live gold price" sx={{ width: '100%' }}>
              {data.live_gold.status === 'success' ? (
                <>
                  <Typography sx={{ fontSize: 32, fontWeight: 600 }}>
                    {formatMoney(data.live_gold.pure_gold_per_pound)} {data.live_gold.currency}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    24K per pound · Last synced {formatLiveTimestamp(data.live_gold.timestamp || data.live_gold.fetched_at)}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1, mt: 2 }}>
                    {data.live_gold.karats.map((karat) => (
                      <Box key={karat.karat_id} sx={{ bgcolor: '#FBF7EE', borderRadius: '14px', p: 1.25 }}>
                        <Typography variant="caption" color="text.secondary">{karat.karat}</Typography>
                        <Typography sx={{ fontWeight: 600 }}>{formatMoney(karat.price_per_pound)}</Typography>
                        <Typography variant="caption" color="text.secondary">LKR / pound</Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  {data.live_gold.status === 'not_configured' ? 'Add METALS_DEV_API_KEY to backend/.env to enable live prices.' : data.live_gold.message}
                </Typography>
              )}
            </SectionCard>
          </Grid>
          )}
          {goldHistoryKarat && (
            <Grid size={{ xs: 12, lg: 6 }} sx={{ display: 'flex' }}>
              <SectionCard title={`${prices.find((p) => p.karat_id === goldHistoryKarat)?.karat || 'Gold'} price movement · 30 days`} to="/gold-prices" sx={{ width: '100%' }}>
                <PriceHistoryChart
                  rows={goldHistory}
                  karat={prices.find((p) => p.karat_id === goldHistoryKarat)?.karat}
                />
              </SectionCard>
            </Grid>
          )}
        </Grid>
      )}

      {businessSummaryCards.length > 0 && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          {businessSummaryCards.map((card) => (
            <Grid key={card.key} size={{ xs: 12, sm: 4, xl: 2 }}>{card}</Grid>
          ))}
        </Grid>
      )}

      {sales && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12 }}>
            <SectionCard title="Sales performance · last 7 days" to="/reports">
              <BarChart data={salesChart} format={(value) => formatAmount(Math.round(value))} height={180} />
            </SectionCard>
          </Grid>
        </Grid>
      )}

      <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
        {data?.inventory && (
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard icon={<InventoryIcon fontSize="small" />} title="Inventory value" to="/items">
              <Typography sx={{ fontSize: 32, fontWeight: 600 }}>{formatAmount(Math.round(data.inventory.value))}</Typography>
              <Typography color="text.secondary" variant="body2">Estimated cost value of current stock</Typography>
            </SectionCard>
          </Grid>
        )}
        {data?.purchases && (
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard icon={<PurchaseIcon fontSize="small" />} title="Purchasing commitments" to="/purchases">
              <Typography sx={{ fontSize: 32, fontWeight: 600 }}>{formatAmount(data.purchases.pending_weight_g)} g</Typography>
              <Typography color="text.secondary" variant="body2">{formatMoney(data.purchases.pending_amount)} still payable to suppliers</Typography>
            </SectionCard>
          </Grid>
        )}
        {data?.workshop && (
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard icon={<WorkshopIcon fontSize="small" />} title="Workshop progress" to="/craft-jobs">
              <Typography sx={{ fontSize: 32, fontWeight: 600 }}>{data.workshop.active_jobs} active jobs</Typography>
              <Typography color="text.secondary" variant="body2">{data.workshop.completed_today} job(s) completed today</Typography>
            </SectionCard>
          </Grid>
        )}
        {data?.customers && (
          <Grid size={{ xs: 12, md: 6 }}>
            <SectionCard icon={<CustomerIcon fontSize="small" />} title="Customer base" to="/customers">
              <Typography sx={{ fontSize: 32, fontWeight: 600 }}>{data.customers.total} customers</Typography>
              <Typography color="text.secondary" variant="body2">Opening receivables: {formatAmount(data.customers.opening_balance)}</Typography>
            </SectionCard>
          </Grid>
        )}
      </Grid>
    </>
  );
}
