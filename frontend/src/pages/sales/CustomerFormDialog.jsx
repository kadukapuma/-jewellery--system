import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, Grid, TextField,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';

export default function CustomerFormDialog({ customer, initialName = '', onClose, onSaved }) {
  const isNew = !customer;
  const { can } = useAuth();
  const notify = useNotify();
  const [form, setForm] = useState({
    name: customer?.name || initialName,
    phone: customer?.phone || '',
    nic: customer?.nic || '',
    address: customer?.address || '',
    credit_limit: customer?.credit_limit ?? 0,
    opening_balance: customer?.opening_balance ?? 0,
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
    const body = { ...form, credit_limit: Number(form.credit_limit) || 0, opening_balance: Number(form.opening_balance) || 0 };
    try {
      const res = isNew ? await api.post('/customers', body) : await api.put(`/customers/${customer.id}`, body);
      notify(isNew ? `${form.name} added` : 'Customer saved');
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
      <DialogTitle>{isNew ? 'Add customer' : `Edit ${customer.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Customer details">
          <Grid size={{ xs: 12 }}>{field('name', 'Name', { required: true, autoFocus: true })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('phone', 'Phone')}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('nic', 'NIC')}</Grid>
          <Grid size={{ xs: 12 }}>{field('address', 'Address', { multiline: true, minRows: 2 })}</Grid>
        </FormSection>
        {(can('sales.credit') || can('customers.edit')) && (
          <FormSection title="Credit & balance">
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('credit_limit', 'Credit limit', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: '0 = must pay in full' })}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('opening_balance', 'Opening balance', { type: 'number', slotProps: { htmlInput: { step: 'any' } }, helperText: 'Owed before using this system' })}
            </Grid>
          </FormSection>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
