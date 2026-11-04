import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, InputAdornment, LinearProgress, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_STATUS } from '../../utils/payments';

export default function PurchasesPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({ search: '', supplier_id: '', payment_status: 'all', from: '', to: '' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sums: null, purchases: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/purchases', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key) => (e) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  };

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Gold and items bought from suppliers"
        actions={can('purchases.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/purchases/new')}>New purchase</Button>
        )}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap' }}>
          <TextField placeholder="Purchase or invoice no." value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setPage(0), setFilters((f) => ({ ...f, search: searchText.trim() })))}
            onBlur={() => setFilters((f) => ({ ...f, search: searchText.trim() }))}
            sx={{ flex: '1 1 200px', maxWidth: 260 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
          <TextField select label="Supplier" value={filters.supplier_id} onChange={setFilter('supplier_id')} sx={{ width: 190 }}>
            <MenuItem value="">All</MenuItem>
            {suppliers.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <TextField select label="Payment" value={filters.payment_status} onChange={setFilter('payment_status')} sx={{ width: 140 }}>
            <MenuItem value="all">All</MenuItem>
            {Object.entries(PAYMENT_STATUS).map(([v, s]) => <MenuItem key={v} value={v}>{s.label}</MenuItem>)}
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
                <TableCell>Purchase</TableCell>
                <TableCell>Supplier</TableCell>
                <TableCell align="right">Lines</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Payment</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.purchases.map((p) => (
                <TableRow key={p.id} hover onClick={() => navigate(`/purchases/${p.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(p.purchase_date)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.purchase_no}</Typography>
                    {p.supplier_invoice_no && <Typography variant="caption" color="text.secondary">Inv {p.supplier_invoice_no}</Typography>}
                  </TableCell>
                  <TableCell>{p.supplier_name}</TableCell>
                  <TableCell align="right">{p.line_count}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(p.total_weight_g)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(p.total_amount)}</TableCell>
                  <TableCell align="right">{p.balance > 0 ? formatMoney(p.balance) : '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Chip size="small" variant="outlined" label={PAYMENT_STATUS[p.payment_status].label} color={PAYMENT_STATUS[p.payment_status].color} />
                    {p.is_overdue && <Chip size="small" color="error" label="Overdue" sx={{ ml: 0.5 }} />}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.purchases.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No purchases found</TableCell></TableRow>
              )}
              {data.sums && data.purchases.length > 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ fontWeight: 600 }}>Total ({data.total})</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeight(data.sums.weight_g)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(data.sums.amount)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(data.sums.balance)}</TableCell>
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
