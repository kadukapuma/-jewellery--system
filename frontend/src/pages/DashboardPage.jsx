import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Grid, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import PersonIcon from '@mui/icons-material/PersonOutlined';
import api, { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useNotify } from '../components/Notify';
import StatCard from '../components/StatCard';
import SectionCard from '../components/SectionCard';
import LoginActivityCard from './dashboard/LoginActivityCard';
import { formatAmount, formatDateTime, formatMoney } from '../utils/format';
import { gold } from '../theme';

const PRICE_TONES = ['gold', 'light', 'gray'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .get('/dashboard', { params: { days } })
      .then((res) => active && setData(res.data))
      .catch((err) => active && notify(errorMessage(err), 'error'));
    return () => { active = false; };
  }, [days, notify]);

  const firstName = user.name.split(' ')[0];
  const hasStats = data && (data.users || data.logins);
  const prices = data?.gold_prices?.prices || [];
  const missingToday = prices.filter((p) => !p.is_today);

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
  const adminCards = [
    data?.users && (
      <StatCard key="users" tone="gold" label="Active users" note={`${data.users.total} accounts in total`} value={data.users.active} to="/users" />
    ),
    data?.logins && (
      <StatCard key="logins" tone="light" label="Logins today" note="Successful sign-ins" value={data.logins.today_success} to="/activity" />
    ),
    data?.logins && (
      <StatCard key="failed" tone="gray" label="Failed logins" note="Wrong password or locked" value={data.logins.today_failed} unit="today" to="/activity" />
    ),
  ].filter(Boolean);
  const sales = data?.sales;
  const salesCards = sales ? [
    <StatCard key="sales-today" tone="gold" label="Sales today" note={`${sales.today_bills} bill(s) · ${formatAmount(Math.round(sales.today_paid))} received`}
      value={formatAmount(Math.round(sales.today_amount))} to="/sales" />,
    <StatCard key="owed" tone="light" label="Customers owe" note={`${sales.owed_bills} bill(s) on credit`}
      value={formatAmount(Math.round(sales.owed_amount))} to={can('customers.view') ? '/customers' : '/sales'} />,
    <StatCard key="overdue" tone="gray" label="Overdue" note="Past the due date"
      value={formatAmount(Math.round(sales.overdue_amount))} to="/sales" />,
  ] : [];
  // Gold prices lead the dashboard, then sales, then admin numbers - each in its own row.
  const [topCards = [], ...otherRows] = [priceCards, salesCards, adminCards].filter((row) => row.length);

  return (
    <>
      <Grid container spacing={2.5} sx={{ mb: 3, alignItems: 'stretch' }}>
        <Grid size={{ xs: 12, xl: 3 }} sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: { xs: 34, md: 44, xl: 46 }, fontWeight: 600, letterSpacing: { xs: -1, xl: -2 }, lineHeight: 1.05, overflowWrap: 'break-word' }}>
              {greeting()},<br />{firstName}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{user.role_name} · {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Typography>
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

      {otherRows.map((row) => (
        <Grid key={row[0].key} container spacing={2.5} sx={{ mb: 3 }}>
          {row.map((card) => (
            <Grid key={card.key} size={{ xs: 12, sm: 4 }}>{card}</Grid>
          ))}
        </Grid>
      ))}

      {hasStats && (
        <Grid container spacing={2.5}>
          {data.logins && (
            <Grid size={{ xs: 12, lg: 7 }}>
              <LoginActivityCard logins={data.logins} days={days} onDaysChange={setDays} />
            </Grid>
          )}
          <Grid size={{ xs: 12, lg: data.logins ? 5 : 12 }}>
            <Stack spacing={2.5}>
              {data.users && (
                <SectionCard icon={<GroupsIcon fontSize="small" />} title="Users by role" to="/roles">
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))', gap: 1 }}>
                    {data.users.by_role.map((r) => (
                      <Box key={r.role} sx={{ textAlign: 'center' }}>
                        <Box sx={{ width: 56, height: 56, mx: 'auto', borderRadius: '50%', bgcolor: gold[100], color: gold[700], display: 'grid', placeItems: 'center' }}>
                          <PersonIcon />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{r.role}</Typography>
                        <Typography sx={{ fontWeight: 600 }}>{r.count}</Typography>
                      </Box>
                    ))}
                  </Box>
                </SectionCard>
              )}
              {data.recent_activity && (
                <SectionCard icon={<HistoryIcon fontSize="small" />} title="Recent activity" to="/activity">
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Time</TableCell>
                          <TableCell>User</TableCell>
                          <TableCell>Action</TableCell>
                          <TableCell>Record</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.recent_activity.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</TableCell>
                            <TableCell>{a.user_name}</TableCell>
                            <TableCell sx={{ textTransform: 'capitalize' }}>{a.action.replace(/_/g, ' ')}</TableCell>
                            <TableCell>{a.table_name}{a.record_id ? ` #${a.record_id}` : ''}</TableCell>
                          </TableRow>
                        ))}
                        {!data.recent_activity.length && (
                          <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>Nothing yet</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Box>
                </SectionCard>
              )}
            </Stack>
          </Grid>
        </Grid>
      )}
    </>
  );
}
