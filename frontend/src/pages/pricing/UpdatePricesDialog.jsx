import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography,
} from '@mui/material';
import CalculateIcon from '@mui/icons-material/CalculateOutlined';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatAmount, formatMoney, formatPercent } from '../../utils/format';
import { stone } from '../../theme';

const BIG_CHANGE = 10; // % change that needs a second look

// Same maths as backend/src/services/pricing.js
const gramFromPound = (pound, gramsPerPound) => Math.round((pound * 100) / gramsPerPound) / 100;
const percentChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 10000) / 100 : null);

export default function UpdatePricesDialog({ prices, gramsPerPound, onClose, onSaved }) {
  const notify = useNotify();
  // Start from the current prices so the admin only edits what changed.
  const [values, setValues] = useState(() => Object.fromEntries(prices.map((p) => [p.karat_id, p.pound_price ?? ''])));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [confirmBig, setConfirmBig] = useState(false);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => [...prices].sort((a, b) => b.purity - a.purity)[0], [prices]);

  const rows = prices.map((p) => {
    const raw = values[p.karat_id];
    const num = raw === '' ? null : Number(raw);
    const valid = num !== null && num > 0;
    return {
      ...p,
      raw,
      num,
      valid,
      gram: valid ? gramFromPound(num, gramsPerPound) : null,
      change: valid ? percentChange(num, p.pound_price) : null,
    };
  });
  const bigChanges = rows.filter((r) => r.change !== null && Math.abs(r.change) > BIG_CHANGE);

  const setValue = (karatId, value) => {
    setValues((v) => ({ ...v, [karatId]: value }));
    setErrors((e) => ({ ...e, [karatId]: undefined }));
    setConfirmBig(false);
  };

  // e.g. 22K = 24K price × 0.916 / 0.999
  const fillFromBase = () => {
    const basePrice = Number(values[base.karat_id]);
    if (!(basePrice > 0)) {
      setErrors({ [base.karat_id]: `Enter the ${base.karat} price first` });
      return;
    }
    const next = { ...values };
    for (const p of prices) {
      if (p.karat_id !== base.karat_id) next[p.karat_id] = Math.round((basePrice * p.purity) / base.purity);
    }
    setValues(next);
    setErrors({});
    setConfirmBig(false);
  };

  const save = async () => {
    setError('');
    const problems = {};
    rows.forEach((r) => {
      if (r.raw !== '' && !r.valid) problems[r.karat_id] = 'Enter a price above 0';
    });
    const toSave = rows.filter((r) => r.valid);
    if (!toSave.length) problems._ = 'Enter at least one price';
    setErrors(problems);
    if (Object.keys(problems).length) {
      if (problems._) setError(problems._);
      return;
    }
    if (bigChanges.length && !confirmBig) {
      setConfirmBig(true);
      return;
    }

    setBusy(true);
    try {
      const res = await api.post('/gold-prices', {
        prices: toSave.map((r) => ({ karat_id: r.karat_id, pound_price: r.num })),
        notes,
      });
      notify(`Prices saved for ${toSave.map((r) => r.karat).join(', ')}`);
      onSaved(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Update gold prices
        <Typography variant="body2" color="text.secondary">
          Enter the price for 1 pound. The gram price is the pound price ÷ {gramsPerPound}.
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {prices.length > 1 && (
          <Button size="small" startIcon={<CalculateIcon />} onClick={fillFromBase} sx={{ mb: 1 }}>
            Calculate other karats from {base.karat} by purity
          </Button>
        )}

        <Stack spacing={1.5}>
          {rows.map((r) => (
            <Box key={r.karat_id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '72px 1fr 150px' }, gap: 1.5, alignItems: 'center', p: 1.5, bgcolor: stone[50], borderRadius: '18px' }}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{r.karat}</Typography>
                <Typography variant="caption" color="text.secondary">{(r.purity * 100).toFixed(1)}%</Typography>
              </Box>
              <TextField
                label="Pound price"
                type="number"
                value={r.raw}
                onChange={(e) => setValue(r.karat_id, e.target.value)}
                error={!!errors[r.karat_id]}
                helperText={errors[r.karat_id] || (r.pound_price !== null ? `Current: ${formatAmount(r.pound_price)}` : 'No price yet')}
                slotProps={{ htmlInput: { min: 0, step: 'any' }, input: { endAdornment: <InputAdornment position="end">/ pound</InputAdornment> } }}
              />
              <Box>
                <Typography variant="caption" color="text.secondary">Gram price</Typography>
                <Typography sx={{ fontWeight: 600 }}>{r.gram !== null ? formatMoney(r.gram) : '—'}</Typography>
                {r.change !== null && r.change !== 0 && (
                  <Chip
                    size="small"
                    label={formatPercent(r.change)}
                    color={Math.abs(r.change) > BIG_CHANGE ? 'warning' : r.change > 0 ? 'success' : 'error'}
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Stack>

        <TextField label="Note (optional)" placeholder="e.g. Morning market rate" value={notes} onChange={(e) => setNotes(e.target.value)} sx={{ mt: 2 }} />

        {confirmBig && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Big change: {bigChanges.map((r) => `${r.karat} ${formatPercent(r.change)}`).join(', ')}. Check the prices, then press
            “Save anyway”.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={confirmBig ? 'warning' : 'primary'} onClick={save} disabled={busy}>
          {confirmBig ? 'Save anyway' : 'Save prices'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
