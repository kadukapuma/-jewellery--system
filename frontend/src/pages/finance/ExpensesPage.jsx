import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import CancelDialog from '../../components/CancelDialog';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import RecordActions from '../../components/RecordActions';
import { formatDate, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS } from '../../utils/payments';
import { methodWithAccount } from '../../utils/bankAccounts';
import ExpenseDialog from './ExpenseDialog';
import ExpenseCategoriesDialog from './ExpenseCategoriesDialog';

function CancelExpenseDialog({ expense, onClose, onDone }) {
  return (
    <CancelDialog
      title={`Cancel ${expense.expense_no}`}
      url={`/expenses/${expense.id}/cancel`}
      intro={`${formatMoney(expense.amount)} for ${expense.category_name}.`}
      reasonPlaceholder="e.g. Entered twice"
      keepText="Keep expense"
      confirmText="Cancel expense"
      onClose={onClose}
      onDone={onDone}
    />
  );
}

export default function ExpensesPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ status: 'active', category_id: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sum_amount: 0, expenses: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const loadCategories = useCallback(() => {
    api.get('/expenses/categories').then((res) => setCategories(res.data)).catch(() => {});
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/expenses', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key) => (e) => { setPage(0); setFilters((f) => ({ ...f, [key]: e.target.value })); };

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Shop running costs – rent, salaries, bills and more"
        actions={can('expenses.create') && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" startIcon={<CategoryIcon />} onClick={() => setManaging(true)}>Categories</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>New expense</Button>
          </Box>
        )}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select label="Status" value={filters.status} onChange={setFilter('status')} sx={{ width: 140 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <TextField select label="Category" value={filters.category_id} onChange={setFilter('category_id')} sx={{ width: 200 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={setFilter('from')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="To" type="date" value={filters.to} onChange={setFilter('to')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">{data.total} expense(s) · {formatMoney(data.sum_amount)}</Typography>
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Expense</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Paid to</TableCell>
                <TableCell>Paid by</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.expenses.map((e) => (
                <TableRow key={e.id} hover sx={{ opacity: e.status === 'cancelled' ? 0.55 : 1 }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.expense_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {e.expense_no}
                    {e.notes && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{e.notes}</Typography>}
                  </TableCell>
                  <TableCell>{e.category_name}</TableCell>
                  <TableCell>{e.paid_to || '—'}</TableCell>
                  <TableCell>{methodWithAccount(PAYMENT_METHODS[e.method], e)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(e.amount)}</TableCell>
                  <TableCell>{e.status === 'cancelled' ? <Chip size="small" label="Cancelled" /> : <Chip size="small" color="success" variant="outlined" label="Active" />}</TableCell>
                  <TableCell align="right">
                    {can('expenses.cancel') && e.status === 'active' && (
                      <Tooltip title="Cancel expense"><IconButton size="small" onClick={() => setCancelling(e)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    <RecordActions record={e} label={e.expense_no} url={`/expenses/${e.id}`} module="expenses"
                      fields={[{ name: 'reference_no', label: 'Reference no.' }, { name: 'notes', label: 'Notes' }]} onDone={load} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.expenses.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No expenses found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, pg) => setPage(pg)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {adding && <ExpenseDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {managing && <ExpenseCategoriesDialog onClose={() => { setManaging(false); loadCategories(); load(); }} />}
      {cancelling && <CancelExpenseDialog expense={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); load(); }} />}
    </>
  );
}
