import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Chip, IconButton, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import CategoryFormDialog, { CATEGORY_TYPES } from './CategoryFormDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';

export default function CategoriesPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {} = new
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/categories');
      setCategories(res.data);
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
      await api.delete(`/categories/${deleting.id}`);
      notify(`${deleting.name} deleted`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  const { pageRows, pager } = usePagedRows(categories);

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Groups for items: rings, chains, gold biscuits…"
        actions={can('categories.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add category</Button>
        )}
      />
      <Card>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">In stock (pcs)</TableCell>
                <TableCell align="right">All items</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.description}</Typography>
                  </TableCell>
                  <TableCell>{CATEGORY_TYPES[c.category_type]}</TableCell>
                  <TableCell align="right">{c.in_stock_qty}</TableCell>
                  <TableCell align="right">{c.item_count}</TableCell>
                  <TableCell>
                    {c.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Disabled" />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {can('categories.edit') && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('categories.delete') && c.item_count === 0 && (
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleting(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !categories.length && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No categories yet. Add Rings, Chains, Gold Biscuits…</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </TableContainer>
      </Card>

      {editing && (
        <CategoryFormDialog
          category={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete category"
        message={`Delete ${deleting?.name}? This cannot be undone.`}
        confirmText="Delete"
        color="error"
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
