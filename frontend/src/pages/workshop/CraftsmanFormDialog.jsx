import { useEffect, useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, MenuItem, Switch, TextField,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval } from '../../api/client';
import { useNotify } from '../../components/Notify';

export default function CraftsmanFormDialog({ craftsman, onClose, onSaved }) {
  const isNew = !craftsman;
  const notify = useNotify();
  const [form, setForm] = useState({
    name: craftsman?.name || '',
    phone: craftsman?.phone || '',
    address: craftsman?.address || '',
    opening_gold_g: craftsman?.opening_gold_g ?? 0,
    opening_gold_karat_id: craftsman?.opening_gold_karat_id ?? '',
    opening_cash_balance: craftsman?.opening_cash_balance ?? 0,
    is_active: craftsman?.is_active ?? true,
  });
  const [karats, setKarats] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/karats').then((res) => setKarats(res.data)).catch(() => {});
  }, []);
  // The craftsman's own karat stays listed even if it was disabled since.
  const karatOptions = karats.filter((k) => k.is_active || k.id === form.opening_gold_karat_id);
  const hasOpeningGold = Number(form.opening_gold_g) !== 0;

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (hasOpeningGold && !form.opening_gold_karat_id) e.opening_gold_karat_id = 'Choose the karat of this gold';
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setBusy(true);
    const body = {
      ...form,
      opening_gold_g: Number(form.opening_gold_g) || 0,
      opening_gold_karat_id: hasOpeningGold ? form.opening_gold_karat_id : null,
      opening_cash_balance: Number(form.opening_cash_balance) || 0,
    };
    try {
      const res = isNew ? await api.post('/craftsmen', body) : await api.put(`/craftsmen/${craftsman.id}`, body);
      if (isPendingApproval(res)) { notify(APPROVAL_MESSAGE, 'info'); onClose(); return; }
      notify(isNew ? `${form.name} added` : 'Craftsman saved');
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (name, label, props = {}) => (
    <TextField label={label} value={form[name]} onChange={set(name)} {...props} error={!!errors[name]} helperText={errors[name] || props.helperText} />
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isNew ? 'Add craftsman' : `Edit ${craftsman.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Craftsman details">
          <Grid size={{ xs: 12, sm: 7 }}>{field('name', 'Name', { required: true, autoFocus: true })}</Grid>
          <Grid size={{ xs: 12, sm: 5 }}>{field('phone', 'Phone')}</Grid>
          <Grid size={{ xs: 12 }}>{field('address', 'Address', { multiline: true, minRows: 2 })}</Grid>
        </FormSection>
        <FormSection title="Opening balances" hint="What stood between you before using this system">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('opening_gold_g', 'Gold already with them', {
              type: 'number',
              slotProps: { htmlInput: { step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } },
              helperText: 'Before using this system',
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('opening_gold_karat_id', 'Karat of that gold', {
              select: true, required: hasOpeningGold, disabled: !hasOpeningGold,
              children: karatOptions.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>),
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('opening_cash_balance', 'Fees already owed to them', {
              type: 'number',
              slotProps: { htmlInput: { step: 'any' } },
              helperText: 'Minus = advance you paid them',
            })}
          </Grid>
          {!isNew && (
            <Grid size={{ xs: 12 }}>
              <FormControlLabel control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
                label={form.is_active ? 'Active' : 'Disabled'} />
            </Grid>
          )}
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
