import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, Switch, TextField,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';

export default function KaratFormDialog({ karat, onClose, onSaved }) {
  const isNew = !karat;
  const notify = useNotify();
  const [form, setForm] = useState({
    name: karat?.name || '',
    purity: karat?.purity ?? '',
    sort_order: karat?.sort_order ?? 0,
    is_active: karat?.is_active ?? true,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const purity = Number(form.purity);
    if (form.purity === '' || !(purity > 0) || purity > 1) e.purity = 'Enter a fraction between 0 and 1, e.g. 0.916';
    return e;
  };

  const save = async () => {
    setError('');
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const body = { ...form, purity: Number(form.purity), sort_order: Number(form.sort_order) || 0 };
    try {
      if (isNew) await api.post('/karats', body);
      else await api.put(`/karats/${karat.id}`, body);
      notify(isNew ? `${body.name.toUpperCase()} added` : 'Karat saved');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const purityPct = Number(form.purity) > 0 && Number(form.purity) <= 1 ? `${(Number(form.purity) * 100).toFixed(1)}% pure gold` : 'e.g. 0.999 for 24K, 0.916 for 22K';

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isNew ? 'Add karat' : `Edit ${karat.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 6 }}>
            <TextField label="Name" required autoFocus placeholder="22K" value={form.name} onChange={set('name')}
              error={!!errors.name} helperText={errors.name} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Display order" type="number" value={form.sort_order} onChange={set('sort_order')}
              error={!!errors.sort_order} helperText={errors.sort_order} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Purity" required type="number" slotProps={{ htmlInput: { step: '0.001', min: 0, max: 1 } }}
              value={form.purity} onChange={set('purity')} error={!!errors.purity} helperText={errors.purity || purityPct} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
              label={form.is_active ? 'Active' : 'Disabled'}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
