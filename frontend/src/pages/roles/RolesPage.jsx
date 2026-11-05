import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Chip, IconButton, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import RoleEditorDialog from './RoleEditorDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';

export default function RolesPage() {
  const { user: me, can } = useAuth();
  const notify = useNotify();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {} = new
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/roles');
      setRoles(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/roles/${deleting.id}`);
      notify(`Role ${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  // A non-Admin cannot edit the role they belong to (server enforces this too).
  const canEdit = (r) => can('roles.edit') && (me.is_super_admin || r.id !== me.role_id);

  const { pageRows, pager } = usePagedRows(roles);

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="A role is a set of permissions. Every user has one role."
        actions={can('roles.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add role</Button>
        )}
      />
      <Card>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Role</TableCell>
                <TableCell>Users</TableCell>
                <TableCell>Permissions</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                      {r.is_system && <Chip size="small" variant="outlined" label="Built-in" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{r.description}</Typography>
                  </TableCell>
                  <TableCell>{r.users_count}</TableCell>
                  <TableCell>{r.is_super_admin ? <Chip size="small" color="primary" label="All" /> : r.permissions_count}</TableCell>
                  <TableCell>
                    {r.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Disabled" />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {canEdit(r) && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('roles.delete') && !r.is_system && (
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleting(r)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </TableContainer>
      </Card>

      {editing && (
        <RoleEditorDialog
          roleId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete role"
        message={`Delete the role "${deleting?.name}"? This cannot be undone.`}
        confirmText="Delete"
        color="error"
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
