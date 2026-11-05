import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { PASSWORD_HINT, passwordProblem } from '../../utils/validation';

export default function ResetPasswordDialog({ user, onClose, onSaved }) {
  const notify = useNotify();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError('');
    const badPassword = passwordProblem(password);
    if (badPassword || password !== confirm) {
      setErrors({ password: badPassword, confirm: password !== confirm ? 'Passwords do not match' : null });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/users/${user.id}/reset-password`, { password });
      notify(`Password reset for ${user.name}`);
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
      <DialogTitle>Reset password – {user.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Alert severity="info">This also unlocks the account. {user.name} must choose a new password at next login.</Alert>
          <TextField label="New password" type="password" autoComplete="new-password" autoFocus value={password}
            onChange={(e) => setPassword(e.target.value)} error={!!errors.password} helperText={errors.password || PASSWORD_HINT} />
          <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} error={!!errors.confirm} helperText={errors.confirm} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Reset password</Button>
      </DialogActions>
    </Dialog>
  );
}
