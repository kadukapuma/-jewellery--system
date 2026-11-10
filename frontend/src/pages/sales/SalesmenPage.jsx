import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Chip, FormControlLabel, Grid, IconButton, InputAdornment, LinearProgress, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import DeleteButton from '../../components/DeleteButton';
import api, { APPROVAL_MESSAGE, errorMessage, isPendingApproval, withReason } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import { formatMoney } from '../../utils/format';
import SalesmanFormDialog from './SalesmanFormDialog';

export default function SalesmenPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [searchText, setSearchText] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [salesmen, setSalesmen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchText.trim()) params.search = searchText.trim();
      if (onlyActive) params.active = 'true';
      const res = await api.get('/salesmen', { params });
      setSalesmen(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [searchText, onlyActive, notify]);

  useEffect(() => { load(); }, [load]);

  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(`/salesmen/${deleting.id}`, withReason(reason));
      if (isPendingApproval(res)) notify(APPROVAL_MESSAGE, 'info');
      else notify(`${deleting.name} deleted`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  const totalSold = salesmen.reduce((sum, s) => sum + s.total_sold, 0);
  const activeCount = salesmen.filter((s) => s.is_active).length;

  return (
    <>
      <PageHeader
        title="Salesmen"
        subtitle="Sales staff attribution and performance tracking"
        actions={can('salesmen.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>
            Add salesman
          </Button>
        )}
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gold" label="Salesmen" note="Registered staff" value={salesmen.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="light" label="Active" note="Available for sales" value={activeCount} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="light" label="Total sales attributed" note="Completed sales" value={formatMoney(totalSold)} />
        </Grid>
      </Grid>

      <Card>
        <Box sx={{ display: 'flex', gap: 2, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            placeholder="Search code, name or phone"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            sx={{ maxWidth: 320 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          />
          <FormControlLabel
            label="Only active"
            control={<Switch checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />}
          />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell align="right">Commission</TableCell>
                <TableCell align="right">Bills</TableCell>
                <TableCell align="right">Total Sold</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {salesmen.map((s) => (
                <TableRow key={s.id} hover sx={{ opacity: s.is_active ? 1 : 0.65 }}>
                  <TableCell sx={{ fontWeight: 600 }}>{s.code}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                    {s.email && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.email}</Typography>}
                  </TableCell>
                  <TableCell>
                    {s.phone || '—'}
                    {s.nic && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>NIC: {s.nic}</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    {s.commission_percent > 0 ? `${s.commission_percent}%` : '—'}
                  </TableCell>
                  <TableCell align="right">{s.sales_count}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(s.total_sold)}</TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={s.is_active ? 'Active' : 'Inactive'}
                      color={s.is_active ? 'success' : 'default'}
                      variant={s.is_active ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {can('salesmen.edit') && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => setEditing(s)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {can('salesmen.delete') && (
                      <DeleteButton
                        label={s.name}
                        disabled={busy}
                        onDelete={(reason) => { setDeleting(s); remove(reason); }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !salesmen.length && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No salesmen found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {editing && (
        <SalesmanFormDialog
          salesman={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

