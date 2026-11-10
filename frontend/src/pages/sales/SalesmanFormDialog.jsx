import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, Switch,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval } from '../../api/client';
import { useNotify } from '../../components/Notify';

export default function SalesmanFormDialog({ salesman, initialName = '', onClose, onSaved }) {
  const isNew = !salesman;
  const notify = useNotify();
  const [form, setForm] = useState({
    code: salesman?.code || '',
    name: salesman?.name || initialName,
    phone: salesman?.phone || '',
    nic: salesman?.nic || '',
    email: salesman?.email || '',
    address: salesman?.address || '',
    commission_percent: salesman?.commission_percent ?? 0,
    is_active: salesman?.is_active ?? true,
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
    if (!form.name.trim()) {
      setErrors({ name: 'Name is required' });
      return;
    }
    setBusy(true);
    const body = {
      ...form,
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      commission_percent: Number(form.commission_percent) || 0,
      is_active: !!form.is_active,
    };
    try {
      const res = isNew ? await api.post('/salesmen', body) : await api.put(`/salesmen/${salesman.id}`, body);
      if (isPendingApproval(res)) {
        notify(APPROVAL_MESSAGE, 'info');
        onClose();
        return;
      }
      notify(isNew ? `${form.name} added as salesman` : 'Salesman updated');
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
      <DialogTitle>{isNew ? 'Add salesman' : `Edit ${salesman.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Salesman details">
          <Grid size={{ xs: 12, sm: 4 }}>
            {field('code', 'Code', { placeholder: 'Auto (e.g. SM-000001)', autoFocus: isNew })}
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            {field('name', 'Name', { required: true, autoFocus: !isNew })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('phone', 'Phone')}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('nic', 'NIC')}
          </Grid>
          <Grid size={{ xs: 12 }}>
            {field('email', 'Email', { type: 'email' })}
          </Grid>
          <Grid size={{ xs: 12 }}>
            {field('address', 'Address', { multiline: true, minRows: 2 })}
          </Grid>
        </FormSection>
        <FormSection title="Settings & Commission">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('commission_percent', 'Commission rate', {
              type: 'number',
              slotProps: {
                htmlInput: { min: 0, max: 100, step: '0.01' },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              },
              helperText: 'Default commission on sales',
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel
              label="Active"
              control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
            />
          </Grid>
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

