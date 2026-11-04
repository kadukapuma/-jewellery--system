import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody,
  TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { actionLabel, groupPermissions } from '../../utils/permissions';

// Per-user exceptions: "Role" = follow the role, "Allow" = extra access, "Block" = take away.
export default function UserPermissionsDialog({ user, onClose }) {
  const notify = useNotify();
  const [permissions, setPermissions] = useState([]);
  const [roleIds, setRoleIds] = useState(new Set());
  const [overrides, setOverrides] = useState({}); // permission_id -> true | false
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/permissions'), api.get(`/users/${user.id}/permissions`)])
      .then(([p, u]) => {
        setPermissions(p.data);
        setRoleIds(new Set(u.data.role_permission_ids));
        setOverrides(Object.fromEntries(u.data.overrides.map((o) => [o.permission_id, o.is_granted])));
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [user.id]);

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);

  const setMode = (permId, mode) => {
    const next = { ...overrides };
    if (mode === 'role' || mode === null) delete next[permId];
    else next[permId] = mode === 'allow';
    setOverrides(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/users/${user.id}/permissions`, {
        overrides: Object.entries(overrides).map(([permission_id, is_granted]) => ({ permission_id: Number(permission_id), is_granted })),
      });
      notify(`Permissions saved for ${user.name}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changed = Object.keys(overrides).length;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Permissions – {user.name}
        <Typography variant="body2" color="text.secondary">
          Role: {user.role_name}. Only change rows where this user should differ from their role.
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Permission</TableCell>
              <TableCell>From role</TableCell>
              <TableCell>This user</TableCell>
              <TableCell>Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((g) => [
              <TableRow key={g.module}>
                <TableCell colSpan={4} sx={{ bgcolor: 'grey.100', fontWeight: 600 }}>{g.label}</TableCell>
              </TableRow>,
              ...g.items.map((p) => {
                const fromRole = roleIds.has(p.id);
                const override = overrides[p.id];
                const mode = override === undefined ? 'role' : override ? 'allow' : 'block';
                const result = override === undefined ? fromRole : override;
                return (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ pl: 4 }}>
                      {actionLabel(p.action)}
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{p.description}</Typography>
                    </TableCell>
                    <TableCell>{fromRole ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <ToggleButtonGroup size="small" exclusive value={mode} onChange={(e, v) => setMode(p.id, v)}>
                        <ToggleButton value="role">Role</ToggleButton>
                        <ToggleButton value="allow" color="success">Allow</ToggleButton>
                        <ToggleButton value="block" color="error">Block</ToggleButton>
                      </ToggleButtonGroup>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={result ? 'Can' : 'Cannot'} color={result ? 'success' : 'default'} variant={mode === 'role' ? 'outlined' : 'filled'} />
                    </TableCell>
                  </TableRow>
                );
              }),
            ])}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flexGrow: 1, pl: 2 }}>
          <Typography variant="body2" color="text.secondary">{changed} exception(s)</Typography>
        </Box>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || loading}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
