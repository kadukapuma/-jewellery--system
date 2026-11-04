import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Card, Chip, Grid, IconButton, InputAdornment, LinearProgress, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ReceiptIcon from '@mui/icons-material/ReceiptLongOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import SupplierFormDialog from './SupplierFormDialog';
import SupplierStatementDialog from './SupplierStatementDialog';
import SupplierPaymentDialog from './SupplierPaymentDialog';

export default function SuppliersPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // {} = new
  const [statementFor, setStatementFor] = useState(null);
  const [payingFor, setPayingFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/suppliers');
      setSuppliers(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? suppliers.filter((s) => [s.name, s.phone, s.email].some((v) => v?.toLowerCase().includes(q))) : suppliers;
  }, [suppliers, search]);

  const owed = suppliers.reduce((sum, s) => sum + Math.max(0, s.balance), 0);
  const overdue = suppliers.reduce((sum, s) => sum + s.overdue, 0);
  const advances = suppliers.reduce((sum, s) => sum + Math.max(0, -s.balance), 0);

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/suppliers/${deleting.id}`);
      notify(`${deleting.name} deleted`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy gold and items from, and what you owe them"
        actions={can('suppliers.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add supplier</Button>}
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gold" label="Owed to suppliers" note={`${suppliers.filter((s) => s.balance > 0).length} supplier(s)`} value={formatAmount(Math.round(owed))} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="light" label="Overdue" note="Past the credit period" value={formatAmount(Math.round(overdue))} to={can('purchases.view') ? '/purchases' : undefined} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gray" label="Advances paid" note="Paid before the goods came" value={formatAmount(Math.round(advances))} to={can('supplier_payments.view') ? '/supplier-payments' : undefined} />
        </Grid>
      </Grid>

      <Card>
        <Box sx={{ p: 2 }}>
          <TextField placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ maxWidth: 360 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Supplier</TableCell>
                <TableCell>Credit</TableCell>
                <TableCell>Last purchase</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{[s.phone, s.email].filter(Boolean).join(' · ')}</Typography>
                  </TableCell>
                  <TableCell>{s.credit_days ? `${s.credit_days} days` : 'Cash'}</TableCell>
                  <TableCell>{formatDate(s.last_purchase_date)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: s.balance > 0 ? 'text.primary' : 'text.secondary' }}>
                      {s.balance < 0 ? `${formatMoney(-s.balance)} adv.` : formatMoney(s.balance)}
                    </Typography>
                    {s.overdue > 0 && <Typography variant="caption" color="error.main">{formatMoney(s.overdue)} overdue</Typography>}
                  </TableCell>
                  <TableCell>
                    {s.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Disabled" />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Statement"><IconButton size="small" onClick={() => setStatementFor(s)}><ReceiptIcon fontSize="small" /></IconButton></Tooltip>
                    {can('supplier_payments.create') && (
                      <Tooltip title="Pay"><IconButton size="small" onClick={() => setPayingFor(s)}><PaymentsIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('suppliers.edit') && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(s)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('suppliers.delete') && !s.purchase_count && !s.payment_count && (
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleting(s)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !filtered.length && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No suppliers yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {editing && (
        <SupplierFormDialog supplier={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {statementFor && (
        <SupplierStatementDialog
          supplierId={statementFor.id}
          onClose={() => setStatementFor(null)}
          onPay={can('supplier_payments.create') ? () => { setPayingFor(statementFor); setStatementFor(null); } : null}
        />
      )}
      {payingFor && (
        <SupplierPaymentDialog supplierId={payingFor.id} onClose={() => setPayingFor(null)} onSaved={() => { setPayingFor(null); load(); }} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete supplier"
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
