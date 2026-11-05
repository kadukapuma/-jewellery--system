import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';

export const CATEGORY_TYPES = { jewellery: 'Jewellery', biscuit: 'Gold biscuit', other: 'Other' };

export default function CategoryFormDialog({ category, onClose, onSaved }) {
  const isNew = !category;
  const notify = useNotify();
  const [form, setForm] = useState({
    name: category?.name || '',
    category_type: category?.category_type || 'jewellery',
    description: category?.description || '',
    is_active: category?.is_active ?? true,
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
    try {
      if (isNew) await api.post('/categories', form);
      else await api.put(`/categories/${category.id}`, form);
      notify(isNew ? `${form.name} added` : 'Category saved');
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
      <DialogTitle>{isNew ? 'Add category' : `Edit ${category.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required autoFocus placeholder="Rings" value={form.name} onChange={set('name')}
            error={!!errors.name} helperText={errors.name} />
          <TextField select label="Type" value={form.category_type} onChange={set('category_type')}
            helperText="Gold biscuits are counted by quantity">
            {Object.entries(CATEGORY_TYPES).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField label="Description" value={form.description} onChange={set('description')} />
          <FormControlLabel
            control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
            label={form.is_active ? 'Active' : 'Disabled'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
