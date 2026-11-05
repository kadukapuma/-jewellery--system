import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, InputAdornment, LinearProgress, MenuItem, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDateTime, formatMoney } from '../../utils/format';
import { PAYMENT_STATUS } from '../../utils/payments';

export default function SalesPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: '', status: 'completed', payment_status: 'all', from: '', to: '' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sums: null, sales: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/sales', { params });
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
        title="Bills"
        subtitle="Every sale, with what is still owed"
        actions={can('sales.create') && <Button variant="contained" startIcon={<AddShoppingCartIcon />} onClick={() => navigate('/pos')}>New sale</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap' }}>
          <TextField placeholder="Bill no., customer or phone" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(0); setFilters((f) => ({ ...f, search: searchText.trim() })); } }}
            onBlur={() => setFilters((f) => ({ ...f, search: searchText.trim() }))}
            sx={{ flex: '1 1 220px', maxWidth: 300 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
          <TextField select label="Payment" value={filters.payment_status} onChange={setFilter('payment_status')} sx={{ width: 140 }}>
            <MenuItem value="all">All</MenuItem>
            {Object.entries(PAYMENT_STATUS).map(([v, s]) => <MenuItem key={v} value={v}>{s.label}</MenuItem>)}
          </TextField>
          <TextField select label="Status" value={filters.status} onChange={setFilter('status')} sx={{ width: 140 }}>
            <MenuItem value="completed">Completed</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={setFilter('from')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="To" type="date" value={filters.to} onChange={setFilter('to')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Bill</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell align="right">Items</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Payment</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.sales.map((s) => (
                <TableRow key={s.id} hover onClick={() => navigate(`/sales/${s.id}`)} sx={{ cursor: 'pointer', opacity: s.status === 'cancelled' ? 0.55 : 1 }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.sale_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{s.invoice_no}</TableCell>
                  <TableCell>
                    {s.customer_name || <Typography variant="body2" color="text.secondary">Walk-in</Typography>}
                    {s.customer_phone && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.customer_phone}</Typography>}
                  </TableCell>
                  <TableCell align="right">{s.line_count}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(s.total)}</TableCell>
                  <TableCell align="right">{s.status === 'completed' && s.balance > 0 ? formatMoney(s.balance) : '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {s.status === 'cancelled' ? <Chip size="small" label="Cancelled" /> : (
                      <>
                        <Chip size="small" variant="outlined" label={PAYMENT_STATUS[s.payment_status].label} color={PAYMENT_STATUS[s.payment_status].color} />
                        {s.is_overdue && <Chip size="small" color="error" label="Overdue" sx={{ ml: 0.5 }} />}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.sales.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>No bills found</TableCell></TableRow>
              )}
              {data.sums && data.sales.length > 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ fontWeight: 600 }}>Total ({data.total})</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(data.sums.amount)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{filters.status === 'completed' ? formatMoney(data.sums.balance) : ''}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>
    </>
  );
}
