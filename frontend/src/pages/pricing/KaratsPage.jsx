import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Chip, IconButton, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import DeleteButton from '../../components/DeleteButton';
import api, { APPROVAL_MESSAGE, errorMessage, isPendingApproval, withReason } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import KaratFormDialog from './KaratFormDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';

export default function KaratsPage() {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [karats, setKarats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {} = new
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/karats');
      setKarats(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(`/karats/${deleting.id}`, withReason(reason));
      if (isPendingApproval(res)) notify(APPROVAL_MESSAGE, 'info');
      else notify(`${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const { pageRows, pager } = usePagedRows(karats);

  return (
    <>
      <PageHeader
        title="Karats"
        subtitle="Gold purities the shop prices and sells. Disabled karats are hidden from price setup."
        actions={can('karats.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add karat</Button>
        )}
      />
      <Card>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Karat</TableCell>
                <TableCell>Purity</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Saved prices</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((k) => (
                <TableRow key={k.id} hover>
                  <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{k.name}</Typography></TableCell>
                  <TableCell>{(k.purity * 100).toFixed(1)}% <Typography component="span" variant="caption" color="text.secondary">({k.purity})</Typography></TableCell>
                  <TableCell>{k.sort_order}</TableCell>
                  <TableCell>{k.price_count}</TableCell>
                  <TableCell>
                    {k.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Disabled" />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {can('karats.edit') && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(k)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('karats.delete') && (
                      <DeleteButton onClick={() => setDeleting(k)}
                        blockedReason={k.price_count > 0 ? 'gold prices were entered for it (old bills use them). Mark it Inactive to stop using it.' : null} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !karats.length && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No karats yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </TableContainer>
      </Card>

      {editing && (
        <KaratFormDialog
          karat={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete karat"
        message={`Delete ${deleting?.name}? Admin can restore it from the Recycle Bin.`}
        confirmText={user.needs_approval ? 'Request delete' : 'Delete'}
        color="error"
        busy={busy}
        reasonLabel={user.needs_approval ? 'Reason (for Admin)' : undefined}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
