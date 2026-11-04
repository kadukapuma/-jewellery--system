import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, FormControlLabel, Grid, IconButton, InputAdornment, LinearProgress, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography,
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
import CustomerFormDialog from './CustomerFormDialog';
import CustomerStatementDialog from './CustomerStatementDialog';
import ReceivePaymentDialog from './ReceivePaymentDialog';

export default function CustomersPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ search: '', owing: false });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, owed: 0, customers: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [receivingFor, setReceivingFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search: filters.search, page, page_size: pageSize };
      if (filters.owing) params.owing = 'true';
      const res = await api.get('/customers', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/customers/${deleting.id}`);
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
        title="Customers"
        subtitle="Who buys from you, and who owes you"
        actions={can('customers.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add customer</Button>}
      />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard tone="gold" label="Customers owe" note="Credit and instalments not yet paid" value={formatAmount(Math.round(data.owed))}
            onClick={() => { setPage(0); setFilters((f) => ({ ...f, owing: true })); }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard tone="light" label="Customers" note={filters.search || filters.owing ? 'Matching the filter' : 'In total'} value={data.total} />
        </Grid>
      </Grid>
      <Card>
        <Box sx={{ display: 'flex', gap: 2, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField placeholder="Name, phone or NIC" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(0); setFilters((f) => ({ ...f, search: searchText.trim() })); } }}
            onBlur={() => setFilters((f) => ({ ...f, search: searchText.trim() }))}
            sx={{ maxWidth: 320 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
          <FormControlLabel label="Only who owe" control={<Switch checked={filters.owing} onChange={(e) => { setPage(0); setFilters((f) => ({ ...f, owing: e.target.checked })); }} />} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Customer</TableCell>
                <TableCell>NIC</TableCell>
                <TableCell align="right">Bills</TableCell>
                <TableCell>Last bill</TableCell>
                <TableCell align="right">Credit limit</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.customers.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.phone}</Typography>
                  </TableCell>
                  <TableCell>{c.nic || '—'}</TableCell>
                  <TableCell align="right">{c.sale_count}</TableCell>
                  <TableCell>{formatDate(c.last_sale_date)}</TableCell>
                  <TableCell align="right">{Number(c.credit_limit) ? formatMoney(c.credit_limit) : 'No credit'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: c.balance > 0 ? 'text.primary' : 'text.secondary' }}>
                      {c.balance < 0 ? `${formatMoney(-c.balance)} adv.` : formatMoney(c.balance)}
                    </Typography>
                    {c.overdue > 0 && <Typography variant="caption" color="error.main">{formatMoney(c.overdue)} overdue</Typography>}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {can('customer_payments.view') && <Tooltip title="Statement"><IconButton size="small" onClick={() => setStatementFor(c)}><ReceiptIcon fontSize="small" /></IconButton></Tooltip>}
                    {can('customer_payments.create') && <Tooltip title="Receive payment"><IconButton size="small" onClick={() => setReceivingFor(c)}><PaymentsIcon fontSize="small" /></IconButton></Tooltip>}
                    {can('customers.edit') && <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
                    {can('customers.delete') && !c.sale_count && !c.payment_count && (
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleting(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.customers.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>No customers found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {editing && <CustomerFormDialog customer={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {statementFor && (
        <CustomerStatementDialog customerId={statementFor.id} onClose={() => setStatementFor(null)}
          onReceive={can('customer_payments.create') ? (c) => { setStatementFor(null); setReceivingFor(c); } : null} />
      )}
      {receivingFor && <ReceivePaymentDialog customer={receivingFor} onClose={() => setReceivingFor(null)} onSaved={() => { setReceivingFor(null); load(); }} />}
      <ConfirmDialog open={!!deleting} title="Delete customer" message={`Delete ${deleting?.name}? This cannot be undone.`}
        confirmText="Delete" color="error" busy={busy} onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  );
}
