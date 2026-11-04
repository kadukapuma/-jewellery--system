import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, Link, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatDateTime } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { REASONS_BY_DIRECTION, STOCK_REASONS, movementLabel, movementLink } from '../../utils/stock';
import { stone } from '../../theme';

const emptyForm = (direction = 'in') => ({ direction, qty: 1, reason: REASONS_BY_DIRECTION[direction][0], note: '' });

// Add or take out stock of one item, with its full stock history underneath.
export default function StockDialog({ item: initial, onClose, onChanged }) {
  const { can } = useAuth();
  const notify = useNotify();
  const [item, setItem] = useState(initial);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/items/${initial.id}/stock`);
      setItem(res.data.item);
      setMovements(res.data.movements);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [initial.id]);

  useEffect(() => { load(); }, [load]);

  // Opened from the history page with only the item's code and name, until the full item loads.
  const ready = item.status !== undefined;
  const canAdjust = ready && can('items.adjust_stock') && item.status !== 'with_craftsman';
  const qty = Number(form.qty);
  const qtyValid = Number.isInteger(qty) && qty >= 1;
  const after = qtyValid ? item.stock_qty + (form.direction === 'in' ? qty : -qty) : null;

  const setDirection = (direction) => {
    if (!direction) return;
    setForm(emptyForm(direction));
    setErrors({});
  };
  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const problems = {};
    if (!qtyValid) problems.qty = 'Enter a whole number, 1 or more';
    else if (after < 0) problems.qty = `Only ${item.stock_qty} in stock`;
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      await api.post(`/items/${item.id}/stock`, { ...form, qty });
      notify(`${item.item_code}: ${form.direction === 'in' ? 'added' : 'took out'} ${qty} · now ${after} in stock`);
      setForm(emptyForm(form.direction));
      await load();
      onChanged?.();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Stock · {item.item_code}
        <Typography variant="body2" color="text.secondary">
          {item.name} · {item.karat_name}{ready && ` · ${formatWeight(item.net_weight_g)} each`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {ready && (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 2 }}>
            <Typography sx={{ fontSize: 36, fontWeight: 600, letterSpacing: -1 }}>{item.stock_qty}</Typography>
            <Typography color="text.secondary">
              in stock · {formatWeight(Math.round(item.net_weight_g * item.stock_qty * 1000) / 1000)} gold
            </Typography>
          </Box>
        )}

        {canAdjust ? (
          <Box sx={{ p: 2, mb: 3, bgcolor: stone[50], borderRadius: '18px' }}>
            <Grid container spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Grid size={{ xs: 12, sm: 'auto' }}>
                <ToggleButtonGroup exclusive size="small" value={form.direction} onChange={(e, v) => setDirection(v)} sx={{ height: 40 }}>
                  <ToggleButton value="in" color="success"><AddIcon fontSize="small" sx={{ mr: 0.5 }} />Add</ToggleButton>
                  <ToggleButton value="out" color="error"><RemoveIcon fontSize="small" sx={{ mr: 0.5 }} />Take out</ToggleButton>
                </ToggleButtonGroup>
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="Qty" type="number" autoFocus value={form.qty} onChange={set('qty')}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }} error={!!errors.qty}
                  helperText={errors.qty || (after !== null && after >= 0 ? `→ ${after} left` : ' ')} />
              </Grid>
              <Grid size={{ xs: 8, sm: 3 }}>
                <TextField select label="Reason" value={form.reason} onChange={set('reason')} error={!!errors.reason} helperText={errors.reason}>
                  {REASONS_BY_DIRECTION[form.direction].map((r) => <MenuItem key={r} value={r}>{STOCK_REASONS[r]}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 'grow' }}>
                <TextField label="Note" placeholder="Optional" value={form.note} onChange={set('note')}
                  slotProps={{ htmlInput: { maxLength: 255 } }} error={!!errors.note} helperText={errors.note} />
              </Grid>
              <Grid size={{ xs: 12, sm: 'auto' }}>
                <Button variant="contained" color={form.direction === 'in' ? 'primary' : 'error'} onClick={save} disabled={busy} sx={{ height: 40 }}>
                  {form.direction === 'in' ? 'Add stock' : 'Take out'}
                </Button>
              </Grid>
            </Grid>
          </Box>
        ) : item.status === 'with_craftsman' && (
          <Alert severity="info" sx={{ mb: 2 }}>This item is with a craftsman. Stock can be changed after it comes back.</Alert>
        )}

        <Typography sx={{ fontWeight: 600, mb: 1 }}>History</Typography>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>What</TableCell>
                <TableCell align="right">Change</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {movements.map((m) => (
                <MovementRow key={m.id} m={m} />
              ))}
              {!loading && !movements.length && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No stock changes yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function MovementRow({ m }) {
  const link = movementLink(m);
  return (
    <TableRow hover>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.created_at)}</TableCell>
      <TableCell>
        <Typography variant="body2">{movementLabel(m)}</Typography>
        {m.ref_no && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {link ? <Link component={RouterLink} to={link}>{m.ref_no}</Link> : m.ref_no}
          </Typography>
        )}
        {m.note && <Typography variant="caption" color="text.secondary">{m.note}</Typography>}
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700, color: m.qty_change > 0 ? 'success.main' : 'error.main' }}>
        {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(Math.abs(Number(m.weight_change_g)))}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{m.qty_after}</TableCell>
      <TableCell>{m.created_by_name}</TableCell>
    </TableRow>
  );
}
