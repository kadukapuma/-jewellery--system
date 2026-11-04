import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import { useNotify } from '../components/Notify';
import api, { errorMessage, fieldErrors } from '../api/client';
import { PASSWORD_HINT, passwordProblem } from '../utils/validation';

export default function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const badPassword = passwordProblem(form.new_password);
    if (badPassword || form.new_password !== form.confirm) {
      setErrors({ new_password: badPassword, confirm: form.new_password !== form.confirm ? 'Passwords do not match' : null });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post('/auth/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setUser(res.data.user);
      notify('Password changed');
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>Change password</Typography>
          {user.must_change_password && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Please set a new password before you continue.
            </Alert>
          )}
          <Stack component="form" spacing={2} onSubmit={submit}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Current password" type="password" autoComplete="current-password"
              value={form.current_password} onChange={set('current_password')}
              error={!!errors.current_password} helperText={errors.current_password} />
            <TextField label="New password" type="password" autoComplete="new-password"
              value={form.new_password} onChange={set('new_password')}
              error={!!errors.new_password} helperText={errors.new_password || PASSWORD_HINT} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password"
              value={form.confirm} onChange={set('confirm')}
              error={!!errors.confirm} helperText={errors.confirm} />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              {user.must_change_password
                ? <Button onClick={logout}>Log out</Button>
                : <Button onClick={() => navigate(-1)}>Cancel</Button>}
              <Button type="submit" variant="contained" disabled={busy}>Save password</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
