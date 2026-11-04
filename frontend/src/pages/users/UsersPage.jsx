import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Chip, IconButton, InputAdornment, LinearProgress, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import LockOpenIcon from '@mui/icons-material/LockOpenOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatDateTime } from '../../utils/format';
import UserFormDialog from './UserFormDialog';
import ResetPasswordDialog from './ResetPasswordDialog';
import UserPermissionsDialog from './UserPermissionsDialog';

function StatusChip({ user }) {
  if (!user.is_active) return <Chip size="small" label="Disabled" />;
  if (user.is_locked) return <Chip size="small" color="error" label="Locked" />;
  if (user.must_change_password) return <Chip size="small" color="warning" variant="outlined" label="New password needed" />;
  return <Chip size="small" color="success" variant="outlined" label="Active" />;
}

export default function UsersPage() {
  const { user: me, can } = useAuth();
  const notify = useNotify();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // {} = new user, user = edit
  const [resetting, setResetting] = useState(null);
  const [permsFor, setPermsFor] = useState(null);
  const [disabling, setDisabling] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.name, u.username, u.role_name, u.phone, u.email].some((v) => v?.toLowerCase().includes(q)));
  }, [users, search]);

  // Only an Admin can manage Admin users (the server enforces this too).
  const canManage = (u) => me.is_super_admin || !u.is_super_admin;

  const unlock = async (u) => {
    try {
      await api.post(`/users/${u.id}/unlock`);
      notify(`${u.name} unlocked`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await api.delete(`/users/${disabling.id}`);
      notify(`${disabling.name} disabled`);
      setDisabling(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="People who can log in to the system"
        actions={can('users.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add user</Button>
        )}
      />

      <Card>
        <Stack direction="row" sx={{ p: 2 }}>
          <TextField
            placeholder="Search name, username, role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ maxWidth: 360 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          />
        </Stack>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Username</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{[u.phone, u.email].filter(Boolean).join(' · ')}</Typography>
                  </TableCell>
                  <TableCell>{u.username}</TableCell>
                  <TableCell>{u.role_name}</TableCell>
                  <TableCell><StatusChip user={u} /></TableCell>
                  <TableCell>{formatDateTime(u.last_login_at)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {canManage(u) && can('users.edit') && (
                      <>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(u)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        {!u.is_super_admin && (
                          <Tooltip title="Extra / blocked permissions">
                            <IconButton size="small" onClick={() => setPermsFor(u)}><TuneIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Reset password"><IconButton size="small" onClick={() => setResetting(u)}><KeyIcon fontSize="small" /></IconButton></Tooltip>
                        {u.is_locked && (
                          <Tooltip title="Unlock"><IconButton size="small" color="error" onClick={() => unlock(u)}><LockOpenIcon fontSize="small" /></IconButton></Tooltip>
                        )}
                      </>
                    )}
                    {canManage(u) && can('users.delete') && u.is_active && u.id !== me.id && (
                      <Tooltip title="Disable"><IconButton size="small" onClick={() => setDisabling(u)}><BlockIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !filtered.length && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No users found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {editing && (
        <UserFormDialog
          user={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onSaved={() => { setResetting(null); load(); }} />}
      {permsFor && <UserPermissionsDialog user={permsFor} onClose={() => setPermsFor(null)} />}
      <ConfirmDialog
        open={!!disabling}
        title="Disable user"
        message={`${disabling?.name} will not be able to log in. Their past records stay in the system. You can enable them again from Edit.`}
        confirmText="Disable"
        color="error"
        busy={busy}
        onConfirm={disable}
        onClose={() => setDisabling(null)}
      />
    </>
  );
}
