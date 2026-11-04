import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import DiamondIcon from '@mui/icons-material/DiamondOutlined';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { gold } from '../theme';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(form.username, form.password);
      navigate(u.must_change_password ? '/change-password' : location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#fff', display: 'flex' }}>
      <Box sx={{ flexGrow: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' } }}>
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between',
            p: 6, color: '#fff',
            background: `linear-gradient(155deg, ${gold[500]} 0%, ${gold[700]} 50%, ${gold[900]} 100%)`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DiamondIcon />
            <Typography sx={{ fontWeight: 700, fontSize: 20 }}>jewellery</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 56, fontWeight: 600, lineHeight: 1.02, letterSpacing: -2 }}>
              Gold, items<br />& billing
            </Typography>
            <Typography sx={{ mt: 2, color: 'rgba(255,255,255,.8)', maxWidth: 360 }}>
              Daily gold prices, stock, craftsmen and customer bills in one place.
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2, md: 4 } }}>
          <Box sx={{ width: '100%', maxWidth: 360 }}>
          <Stack spacing={1} sx={{ mb: 4 }}>
            <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1, color: 'primary.main', mb: 2 }}>
              <DiamondIcon />
              <Typography sx={{ fontWeight: 700, fontSize: 20 }}>jewellery</Typography>
            </Box>
            <Typography sx={{ fontWeight: 600, fontSize: 36, letterSpacing: -1, lineHeight: 1.1 }}>Welcome back</Typography>
            <Typography color="text.secondary">Log in to continue</Typography>
          </Stack>
          <Stack component="form" spacing={2} onSubmit={submit}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Username"
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </Stack>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
