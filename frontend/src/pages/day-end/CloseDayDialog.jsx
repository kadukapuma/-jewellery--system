import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Collapse, DialogActions, DialogContent, DialogTitle, Grid, Table, TableBody, TableCell, TableRow, Typography,
} from '@mui/material';
import CalculateIcon from '@mui/icons-material/CalculateOutlined';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatDate, formatMoney } from '../../utils/format';
import { stone } from '../../theme';

// Notes counted one by one (optional) - the total fills "Cash counted".
const NOTES = [5000, 2000, 1000, 500, 100, 50, 20];
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function DifferenceLine({ difference }) {
  if (difference === null) return null;
  const flat = Math.abs(difference) < 0.005;
  const short = difference < 0;
  return (
    <Alert severity={flat ? 'success' : short ? 'error' : 'warning'} sx={{ mt: 2 }}>
      {flat ? 'Cash matches exactly.' : short
        ? `Cash is SHORT by ${formatMoney(-difference)}.`
        : `Cash is OVER (excess) by ${formatMoney(difference)}.`}
    </Alert>
  );
}

// Count the cash in the drawer and close (lock) the day.
export default function CloseDayDialog({ date, cash, bank, onClose, onClosed }) {
  const notify = useNotify();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [byNotes, setByNotes] = useState(false);
  const [pieces, setPieces] = useState({});
  const [coins, setCoins] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const noteTotal = useMemo(
    () => round2(NOTES.reduce((s, n) => s + n * (Number(pieces[n]) || 0), 0) + (Number(coins) || 0)),
    [pieces, coins],
  );
  const countedValue = byNotes ? noteTotal : counted === '' ? null : Number(counted);
  const difference = countedValue === null || Number.isNaN(countedValue) ? null : round2(countedValue - cash.closing);

  const save = async () => {
    setError('');
    if (countedValue === null || Number.isNaN(countedValue) || countedValue < 0) {
      setErrors({ counted_cash: 'Enter the cash you counted' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/day-end/close', { date, counted_cash: countedValue, notes });
      notify(`${formatDate(date)} closed`);
      onClosed(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const row = (label, value, bold) => (
    <TableRow sx={{ '& td': { fontWeight: bold ? 700 : 400, borderColor: stone[100] } }}>
      <TableCell>{label}</TableCell>
      <TableCell align="right">{value}</TableCell>
    </TableRow>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Close day · {formatDate(date)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <FormSection title="Cash in hand (system)" hint="What should be in the drawer, from every cash receipt and payment">
          <Grid size={12}>
            <Table size="small">
              <TableBody>
                {row('Opening cash', formatMoney(cash.opening))}
                {row('+ Cash in today', formatMoney(cash.money_in))}
                {row('− Cash out today', formatMoney(cash.money_out))}
                {row('Expected cash in drawer', formatMoney(cash.closing), true)}
                {row('Bank (card / transfer / cheque) closing', formatMoney(bank.closing))}
              </TableBody>
            </Table>
          </Grid>
        </FormSection>

        <FormSection title="Cash counted" hint="Count the money in the drawer and enter the total">
          <Grid size={12}>
            {!byNotes ? (
              <TextField
                label="Cash counted" type="number" fullWidth autoFocus value={counted}
                onChange={(e) => { setCounted(e.target.value); setErrors({}); }}
                error={!!errors.counted_cash} helperText={errors.counted_cash}
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
              />
            ) : (
              <Typography sx={{ fontWeight: 700, fontSize: 22 }}>Counted: {formatMoney(noteTotal)}</Typography>
            )}
            <Button size="small" startIcon={<CalculateIcon />} sx={{ mt: 1 }} onClick={() => setByNotes((v) => !v)}>
              {byNotes ? 'Type the total instead' : 'Count by notes'}
            </Button>
            <Collapse in={byNotes}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 1.5, mt: 1.5 }}>
                {NOTES.map((n) => (
                  <TextField
                    key={n} label={`${n.toLocaleString()} ×`} type="number" size="small" value={pieces[n] ?? ''}
                    onChange={(e) => setPieces({ ...pieces, [n]: e.target.value })}
                    helperText={pieces[n] ? formatMoney(n * Number(pieces[n])) : ' '}
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                  />
                ))}
                <TextField
                  label="Coins / other" type="number" size="small" value={coins} onChange={(e) => setCoins(e.target.value)}
                  helperText=" " slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                />
              </Box>
            </Collapse>
            <DifferenceLine difference={difference} />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Notes" fullWidth multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for any shortage / excess, who counted ..." slotProps={{ htmlInput: { maxLength: 255 } }}
            />
          </Grid>
        </FormSection>

        <Alert severity="warning" sx={{ mt: 3 }}>
          After closing, no bills, receipts, purchases, expenses, payments or cash entries can be added or cancelled
          for {formatDate(date)}. Only an Admin can re-open the day.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Close day</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ReopenDayDialog({ closing, onClose, onDone }) {
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!reason.trim()) { setError('Give a reason'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/day-end/${closing.id}/reopen`, { reason });
      notify(`${formatDate(closing.close_date)} re-opened`);
      onDone(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Re-open {formatDate(closing.close_date)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          The day will be unlocked so entries can be corrected. Close it again afterwards.
        </Typography>
        <TextField label="Reason" fullWidth autoFocus multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 255 } }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="error" onClick={save} disabled={busy}>Re-open day</Button>
      </DialogActions>
    </Dialog>
  );
}
