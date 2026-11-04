import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid,
  LinearProgress, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { actionLabel, groupPermissions } from '../../utils/permissions';

export default function RoleEditorDialog({ roleId, onClose, onSaved }) {
  const isNew = !roleId;
  const notify = useNotify();
  const [permissions, setPermissions] = useState([]);
  const [role, setRole] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', is_active: true });
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const requests = [api.get('/permissions')];
    if (!isNew) requests.push(api.get(`/roles/${roleId}`));
    Promise.all(requests)
      .then(([p, r]) => {
        setPermissions(p.data);
        if (r) {
          setRole(r.data);
          setForm({ name: r.data.name, description: r.data.description || '', is_active: r.data.is_active });
          setSelected(new Set(r.data.permission_ids));
        }
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [roleId, isNew]);

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const isSuperAdmin = role?.is_super_admin;
  const isSystem = role?.is_system;

  const toggle = (ids, on) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelected(next);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    const body = { ...form, permission_ids: [...selected] };
    try {
      if (isNew) await api.post('/roles', body);
      else await api.put(`/roles/${roleId}`, body);
      notify(isNew ? `Role ${form.name} created` : 'Role saved');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isNew ? 'Add role' : `Edit role – ${role?.name ?? ''}`}</DialogTitle>
      <DialogContent dividers>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField label="Role name" required value={form.name} disabled={isSystem}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={!!errors.name} helperText={errors.name || (isSystem ? 'Built-in roles cannot be renamed' : '')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField label="Description" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2 }}>
            <FormControlLabel label="Active" disabled={isSuperAdmin}
              control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />} />
          </Grid>
        </Grid>

        {isSuperAdmin ? (
          <Alert severity="info">The Admin role always has every permission. Only its description can be changed.</Alert>
        ) : (
          <>
            <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
              <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>
                Permissions ({selected.size} of {permissions.length})
              </Typography>
              <Button size="small" onClick={() => toggle(permissions.map((p) => p.id), true)}>Select all</Button>
              <Button size="small" onClick={() => setSelected(new Set())}>Clear</Button>
            </Stack>
            <Stack spacing={1}>
              {groups.map((g) => {
                const ids = g.items.map((p) => p.id);
                const count = ids.filter((id) => selected.has(id)).length;
                return (
                  <Paper key={g.module} variant="outlined" sx={{ px: 2, py: 1 }}>
                    <FormControlLabel
                      label={<Typography sx={{ fontWeight: 600 }}>{g.label}</Typography>}
                      control={
                        <Checkbox
                          checked={count === ids.length}
                          indeterminate={count > 0 && count < ids.length}
                          onChange={(e) => toggle(ids, e.target.checked)}
                        />
                      }
                    />
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', pl: 4 }}>
                      {g.items.map((p) => (
                        <FormControlLabel
                          key={p.id}
                          title={p.description}
                          label={actionLabel(p.action)}
                          control={<Checkbox size="small" checked={selected.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} />}
                        />
                      ))}
                    </Box>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || loading}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
