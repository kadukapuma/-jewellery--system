import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, Switch, TextField,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { emailProblem } from '../../utils/validation';

export default function SupplierFormDialog({ supplier, onClose, onSaved }) {
  const isNew = !supplier;
  const notify = useNotify();
  const [form, setForm] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    opening_balance: supplier?.opening_balance ?? 0,
    credit_days: supplier?.credit_days ?? 0,
    is_active: supplier?.is_active ?? true,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const badEmail = emailProblem(form.email);
    if (badEmail) e.email = badEmail;
    if (!Number.isInteger(Number(form.credit_days)) || Number(form.credit_days) < 0) e.credit_days = 'Whole days, 0 or more';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { ...form, opening_balance: Number(form.opening_balance) || 0, credit_days: Number(form.credit_days) || 0 };
    try {
      const res = isNew ? await api.post('/suppliers', body) : await api.put(`/suppliers/${supplier.id}`, body);
      if (isPendingApproval(res)) { notify(APPROVAL_MESSAGE, 'info'); onClose(); return; }
      notify(isNew ? `${form.name} added` : 'Supplier saved');
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
      <DialogTitle>{isNew ? 'Add supplier' : `Edit ${supplier.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Supplier details">
          <Grid size={{ xs: 12 }}>{field('name', 'Supplier name', { required: true, autoFocus: true })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('phone', 'Phone')}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('email', 'Email')}</Grid>
          <Grid size={{ xs: 12 }}>{field('address', 'Address', { multiline: true, minRows: 2 })}</Grid>
        </FormSection>
        <FormSection title="Payment terms">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('credit_days', 'Credit period', {
              type: 'number',
              slotProps: { htmlInput: { min: 0, step: 1 }, input: { endAdornment: <InputAdornment position="end">days</InputAdornment> } },
              helperText: 'Days until a purchase must be paid',
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('opening_balance', 'Opening balance', {
              type: 'number',
              slotProps: { htmlInput: { step: 'any' } },
              helperText: 'What you owed them before using this system (minus = advance)',
            })}
          </Grid>
          {!isNew && (
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
                label={form.is_active ? 'Active' : 'Disabled'}
              />
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
