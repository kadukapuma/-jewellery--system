import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, MenuItem, Switch, TextField,
} from '@mui/material';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { PASSWORD_HINT, emailProblem, passwordProblem } from '../../utils/validation';

export default function UserFormDialog({ user, onClose, onSaved }) {
  const isNew = !user;
  const { user: me } = useAuth();
  const notify = useNotify();
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
    role_id: user?.role_id || '',
    is_active: user?.is_active ?? true,
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSelf = user?.id === me.id;

  useEffect(() => {
    api.get('/roles').then((res) => setRoles(res.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  // Non-admins cannot hand out the Admin role.
  const selectableRoles = roles.filter((r) => (r.is_active || r.id === form.role_id) && (me.is_super_admin || !r.is_super_admin));

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.role_id) e.role_id = 'Select a role';
    const badEmail = emailProblem(form.email);
    if (badEmail) e.email = badEmail;
    if (isNew) {
      if (form.username.trim().length < 3) e.username = 'At least 3 characters';
      else if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) e.username = 'Use letters, numbers, dot, dash or underscore only';
      const badPassword = passwordProblem(form.password);
      if (badPassword) e.password = badPassword;
      if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    }
    return e;
  };

  const save = async () => {
    setError('');
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setErrors({});
    const body = { name: form.name, email: form.email, phone: form.phone, role_id: form.role_id };
    try {
      if (isNew) {
        await api.post('/users', { ...body, username: form.username, password: form.password });
        notify(`User ${form.username} created`);
      } else {
        await api.put(`/users/${user.id}`, { ...body, is_active: form.is_active });
        notify('User updated');
      }
      onSaved();
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
      <DialogTitle>{isNew ? 'Add user' : `Edit ${user.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>{field('name', 'Full name', { required: true, autoFocus: true })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('username', 'Username', { required: true, disabled: !isNew })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('phone', 'Phone')}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('email', 'Email')}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('role_id', 'Role', {
              select: true,
              required: true,
              disabled: isSelf,
              helperText: isSelf ? 'You cannot change your own role' : undefined,
              children: selectableRoles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>),
            })}
          </Grid>
          {!isNew && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={<Switch checked={form.is_active} disabled={isSelf} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
                label={form.is_active ? 'Active' : 'Disabled'}
              />
            </Grid>
          )}
          {isNew && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('password', 'Password', { type: 'password', required: true, autoComplete: 'new-password', helperText: `${PASSWORD_HINT}. They change it at first login.` })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('confirm', 'Confirm password', { type: 'password', required: true, autoComplete: 'new-password' })}
              </Grid>
            </>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
