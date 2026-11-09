import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, ButtonBase, DialogActions, DialogContent, DialogTitle, Grid, IconButton, LinearProgress, MenuItem, Skeleton, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import EditIcon from '@mui/icons-material/EditOutlined';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval, withReason } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import SectionCard from '../../components/SectionCard';
import { formatAmount, formatDateTime, formatMoney, formatPercent, formatTime } from '../../utils/format';
import { ink, stone } from '../../theme';
import UpdatePricesDialog from './UpdatePricesDialog';
import PriceHistoryChart from './PriceHistoryChart';
import TablePager, { usePagedRows } from '../../components/TablePager';
import Dialog from '../../components/Dialog';
import ConfirmDialog from '../../components/ConfirmDialog';

const TONES = ['gold', 'light', 'gray'];
const PERIODS = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 365, label: '1Y' },
];

function changeOf(row) {
  if (row.previous_pound_price === null) return null;
  return Math.round(((row.pound_price - row.previous_pound_price) / row.previous_pound_price) * 10000) / 100;
}

// Fix or remove a wrongly typed price. The server refuses prices a bill has already used.
function PriceRowActions({ price, onDone }) {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ pound_price: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const done = (res, message) => {
    notify(isPendingApproval(res) ? APPROVAL_MESSAGE : message, isPendingApproval(res) ? 'info' : 'success');
    onDone();
  };
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put(`/gold-prices/${price.id}`, { pound_price: Number(form.pound_price), notes: form.notes });
      setEditing(false);
      done(res, 'Price fixed');
    } catch (err) {
      setErrors(fieldErrors(err));
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(`/gold-prices/${price.id}`, withReason(reason));
      done(res, 'Price deleted');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(false);
      setBusy(false);
    }
  };

  return (
    <>
      {can('gold_prices.edit') && (
        <Tooltip title="Fix this price">
          <IconButton size="small" onClick={() => { setForm({ pound_price: String(price.pound_price), notes: price.notes || '' }); setErrors({}); setEditing(true); }}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {can('gold_prices.delete') && (
        <Tooltip title="Delete this price">
          <IconButton size="small" color="error" onClick={() => setDeleting(true)}><DeleteIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      <Dialog open={editing} onClose={() => setEditing(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Fix {price.karat} price</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>Only a price that no bill has used can be fixed. Otherwise enter a new price.</Alert>
          <Stack spacing={2}>
            <TextField label="Pound price" type="number" value={form.pound_price} onChange={(e) => setForm({ ...form, pound_price: e.target.value })}
              error={!!errors.pound_price} helperText={errors.pound_price} />
            <TextField label="Note" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy || !(Number(form.pound_price) > 0)}>
            {user.needs_approval ? 'Send for approval' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        title={`Delete ${price.karat} price`}
        message={`Delete the price of ${formatMoney(price.pound_price)} from ${formatDateTime(price.effective_at)}? Only a price no bill has used can be deleted. Admin can restore it from the Recycle Bin.`}
        confirmText={user.needs_approval ? 'Request delete' : 'Delete'}
        color="error"
        busy={busy}
        reasonLabel={user.needs_approval ? 'Reason (for Admin)' : undefined}
        onConfirm={remove}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

export default function GoldPricesPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [current, setCurrent] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [karatId, setKaratId] = useState('');
  const [days, setDays] = useState(30);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadCurrent = useCallback(async () => {
    try {
      const res = await api.get('/gold-prices/current');
      setCurrent(res.data);
      setKaratId((id) => id || res.data.prices[0]?.karat_id || '');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }, [notify]);

  useEffect(() => { loadCurrent(); }, [loadCurrent]);

  useEffect(() => {
    if (!karatId) return undefined;
    let active = true;
    setHistoryLoading(true);
    api
      .get('/gold-prices/history', { params: { karat_id: karatId, days } })
      .then((res) => active && setHistory(res.data))
      .catch((err) => active && notify(errorMessage(err), 'error'))
      .finally(() => active && setHistoryLoading(false));
    return () => { active = false; };
  }, [karatId, days, notify, current]);

  const prices = current?.prices || [];
  const missingToday = prices.filter((p) => !p.is_today);
  const selected = prices.find((p) => p.karat_id === karatId);

  const { pageRows, pager } = usePagedRows(history);

  return (
    <>
      <PageHeader
        title="Gold prices"
        subtitle={current ? `Enter the price for 1 pound — the gram price is pound ÷ ${current.grams_per_pound}.` : ' '}
        actions={can('gold_prices.update') && prices.length > 0 && (
          <Button variant="contained" startIcon={<EditIcon />} onClick={() => setUpdating(true)}>Update prices</Button>
        )}
      />

      {current && prices.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>No active karats. Add one on the Karats page first.</Alert>
      )}
      {current && missingToday.length > 0 && prices.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}
          action={can('gold_prices.update') && <Button color="inherit" size="small" onClick={() => setUpdating(true)}>Update now</Button>}>
          Today's price is not entered yet for {missingToday.map((p) => p.karat).join(', ')}. Sales will use the last saved price.
        </Alert>
      )}

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        {!current && [0, 1, 2].map((i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, lg: 4 }}><Skeleton variant="rounded" height={150} sx={{ borderRadius: '28px' }} /></Grid>
        ))}
        {prices.map((p, i) => (
          <Grid key={p.karat_id} size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              tone={TONES[i % TONES.length]}
              label={`${p.karat} · 1 pound`}
              value={p.pound_price !== null ? formatAmount(p.pound_price) : '—'}
              note={p.pound_price !== null
                ? `1 gram ${formatMoney(p.gram_price)} · ${p.is_today ? `today ${formatTime(p.effective_at)}` : formatDateTime(p.effective_at)}`
                : 'No price entered yet'}
              trend={p.change_percent}
              onClick={() => setKaratId(p.karat_id)}
            />
          </Grid>
        ))}
      </Grid>

      {prices.length > 0 && (
        <SectionCard icon={<ShowChartIcon fontSize="small" />} title="Price history">
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <TextField select label="Karat" value={karatId} onChange={(e) => setKaratId(e.target.value)} sx={{ width: 140 }}>
              {prices.map((p) => <MenuItem key={p.karat_id} value={p.karat_id}>{p.karat}</MenuItem>)}
            </TextField>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: stone[50], border: `1px solid ${stone[100]}`, borderRadius: 999 }}>
              {PERIODS.map((p) => (
                <ButtonBase key={p.days} onClick={() => setDays(p.days)}
                  sx={{ px: 1.75, height: 34, borderRadius: 999, fontWeight: 600, fontSize: 13,
                    bgcolor: days === p.days ? ink : 'transparent', color: days === p.days ? '#fff' : ink }}>
                  {p.label}
                </ButtonBase>
              ))}
            </Box>
          </Box>

          {historyLoading && <LinearProgress sx={{ mb: 1 }} />}
          {!historyLoading && <PriceHistoryChart rows={history} karat={selected?.karat} />}

          <Typography sx={{ fontWeight: 600, mt: 3, mb: 1 }}>All {selected?.karat} price updates</Typography>
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Date & time</TableCell>
                  <TableCell align="right">Pound price</TableCell>
                  <TableCell align="right">Gram price</TableCell>
                  <TableCell align="right">Change</TableCell>
                  <TableCell>Entered by</TableCell>
                  <TableCell>Note</TableCell>
                  {(can('gold_prices.edit') || can('gold_prices.delete')) && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((h) => {
                  const change = changeOf(h);
                  return (
                    <TableRow key={h.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(h.effective_at)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(h.pound_price)}</TableCell>
                      <TableCell align="right">{formatMoney(h.gram_price)}</TableCell>
                      <TableCell align="right" sx={{ color: change > 0 ? 'success.main' : change < 0 ? 'error.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {change === null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${formatPercent(change)}`}
                      </TableCell>
                      <TableCell>{h.entered_by_name}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{h.notes}</TableCell>
                      {(can('gold_prices.edit') || can('gold_prices.delete')) && (
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><PriceRowActions price={h} onDone={loadCurrent} /></TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {!historyLoading && !history.length && (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>No prices in this period</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <TablePager {...pager} />
          </TableContainer>
        </SectionCard>
      )}

      {updating && current && (
        <UpdatePricesDialog
          prices={prices}
          gramsPerPound={current.grams_per_pound}
          onClose={() => setUpdating(false)}
          onSaved={(data) => { setUpdating(false); setCurrent(data); }}
        />
      )}
    </>
  );
}
