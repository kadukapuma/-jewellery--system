import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem, TextField, Typography,
} from '@mui/material';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatWeight } from '../../utils/pricing';
import { todayYmd } from '../../utils/payments';

const TYPES = {
  gold_returned: 'Gold given back to the shop',
  extra_issue: 'Extra gold given to the craftsman',
  adjustment: 'Correction (+ or −)',
};

export default function GoldAdjustmentDialog({ craftsman, onClose, onSaved }) {
  const notify = useNotify();
  const [karats, setKarats] = useState([]);
  const [form, setForm] = useState({ txn_type: 'gold_returned', karat_id: '', weight_g: '', txn_date: todayYmd(), notes: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/karats').then((res) => setKarats(res.data.filter((k) => k.is_active))).catch(() => {});
  }, []);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const w = Number(form.weight_g) || 0;
  const signed = form.txn_type === 'extra_issue' ? Math.abs(w) : form.txn_type === 'gold_returned' ? -Math.abs(w) : w;
  const after = Math.round((craftsman.gold_held_g + signed) * 1000) / 1000;

  const save = async () => {
    setError('');
    const e = {};
    if (!form.karat_id) e.karat_id = 'Choose a karat';
    if (!w) e.weight_g = 'Enter a weight';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.post(`/craftsmen/${craftsman.id}/gold-adjustments`, { ...form, weight_g: w });
      notify('Gold account updated');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Gold movement – {craftsman.name}
        <Typography variant="body2" color="text.secondary">Holds {formatWeight(craftsman.gold_held_g)} now</Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12 }}>
            <TextField select label="What happened" value={form.txn_type} onChange={set('txn_type')}>
              {Object.entries(TYPES).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField select label="Karat" value={form.karat_id} onChange={set('karat_id')} error={!!errors.karat_id} helperText={errors.karat_id}>
              {karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Weight" type="number" value={form.weight_g} onChange={set('weight_g')} error={!!errors.weight_g}
              helperText={errors.weight_g || `After: ${formatWeight(after)}`}
              slotProps={{ htmlInput: { step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Date" type="date" value={form.txn_date} onChange={set('txn_date')} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12 }}><TextField label="Note" value={form.notes} onChange={set('notes')} placeholder="e.g. Leftover from JOB-000003" /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
