import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, IconButton, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';

// Add, rename and switch off expense categories. A category in use cannot be deleted, only switched off.
export default function ExpenseCategoriesDialog({ onClose }) {
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/expenses/categories').then((res) => setCategories(res.data)).catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, message) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      if (message) notify(message);
      load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    if (await run(() => api.post('/expenses/categories', { name: newName.trim() }), `${newName.trim()} added`)) setNewName('');
  };
  const rename = async (c) => {
    if (!editing.name.trim()) return;
    if (await run(() => api.put(`/expenses/categories/${c.id}`, { name: editing.name.trim(), is_active: !!c.is_active }), 'Category saved')) setEditing(null);
  };
  const toggle = (c) => run(() => api.put(`/expenses/categories/${c.id}`, { name: c.name, is_active: !c.is_active }));

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Expense categories</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField label="New category" size="small" fullWidth value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Security" />
          <Button variant="contained" onClick={add} disabled={busy || !newName.trim()}>Add</Button>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell align="center">In use</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.id} sx={{ opacity: c.is_active ? 1 : 0.55 }}>
                <TableCell>
                  {editing?.id === c.id ? (
                    <TextField size="small" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && rename(c)} />
                  ) : c.name}
                </TableCell>
                <TableCell align="right">{c.expense_count}</TableCell>
                <TableCell align="center"><Switch size="small" checked={!!c.is_active} onChange={() => toggle(c)} disabled={busy} /></TableCell>
                <TableCell align="right">
                  {editing?.id === c.id ? (
                    <Tooltip title="Save"><IconButton size="small" onClick={() => rename(c)} disabled={busy}><CheckIcon fontSize="small" /></IconButton></Tooltip>
                  ) : (
                    <Tooltip title="Rename"><IconButton size="small" onClick={() => setEditing({ id: c.id, name: c.name })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Switched-off categories stay on old expenses but cannot be picked for new ones.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
