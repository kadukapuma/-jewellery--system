import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import CancelDialog from '../../components/CancelDialog';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import RecordActions from '../../components/RecordActions';
import { formatDate, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS } from '../../utils/payments';
import SupplierPaymentDialog from './SupplierPaymentDialog';

function CancelPaymentDialog({ payment, onClose, onDone }) {
  return (
    <CancelDialog
      title={`Cancel ${payment.payment_no}`}
      url={`/supplier-payments/${payment.id}/cancel`}
      intro={`${formatMoney(payment.amount)} to ${payment.supplier_name}. The record stays in the history.`}
      reasonPlaceholder="e.g. Cheque bounced"
      keepText="Keep payment"
      confirmText="Cancel payment"
      onClose={onClose}
      onDone={onDone}
    />
  );
}

export default function SupplierPaymentsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({ supplier_id: '', status: 'active' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sum_amount: 0, payments: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/supplier-payments', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const toggleDetails = async (p) => {
    if (expanded?.id === p.id) { setExpanded(null); return; }
    try {
      const res = await api.get(`/supplier-payments/${p.id}`);
      setExpanded(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Supplier payments"
        subtitle="Money paid to suppliers and which purchases it settled"
        actions={can('supplier_payments.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Pay supplier</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select label="Supplier" value={filters.supplier_id} onChange={(e) => { setPage(0); setFilters({ ...filters, supplier_id: e.target.value }); }} sx={{ width: 200 }}>
            <MenuItem value="">All</MenuItem>
            {suppliers.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <TextField select label="Status" value={filters.status} onChange={(e) => { setPage(0); setFilters({ ...filters, status: e.target.value }); }} sx={{ width: 150 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">{data.total} payment(s) · {formatMoney(data.sum_amount)}</Typography>
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Payment</TableCell>
                <TableCell>Supplier</TableCell>
                <TableCell>Paid by</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Advance left</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.payments.flatMap((p) => [
                <TableRow key={p.id} hover onClick={() => toggleDetails(p)} sx={{ cursor: 'pointer', opacity: p.status === 'cancelled' ? 0.6 : 1 }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(p.payment_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{p.payment_no}</TableCell>
                  <TableCell>{p.supplier_name}</TableCell>
                  <TableCell>{PAYMENT_METHODS[p.method]}{p.reference_no ? ` · ${p.reference_no}` : ''}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(p.amount)}</TableCell>
                  <TableCell align="right">{p.status === 'active' && p.unallocated > 0 ? formatMoney(p.unallocated) : '—'}</TableCell>
                  <TableCell>
                    {p.status === 'cancelled' ? <Chip size="small" label="Cancelled" /> : <Chip size="small" color="success" variant="outlined" label="Active" />}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {can('supplier_payments.cancel') && p.status === 'active' && (
                      <Tooltip title="Cancel payment"><IconButton size="small" onClick={() => setCancelling(p)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    <RecordActions record={p} label={p.payment_no} url={`/supplier-payments/${p.id}`} module="supplier_payments"
                      fields={[{ name: 'reference_no', label: 'Reference no.' }, { name: 'cheque_date', label: 'Cheque date', type: 'date' }, { name: 'notes', label: 'Notes' }]} onDone={() => { setExpanded(null); load(); }} />
                  </TableCell>
                </TableRow>,
                expanded?.id === p.id && (
                  <TableRow key={`${p.id}-d`}>
                    <TableCell colSpan={8} sx={{ bgcolor: 'action.hover' }}>
                      {expanded.allocations.length ? (
                        expanded.allocations.map((a) => (
                          <Typography key={a.purchase_id} variant="body2">
                            <Button size="small" sx={{ p: 0, minWidth: 0, mr: 1 }} onClick={() => navigate(`/purchases/${a.purchase_id}`)}>{a.purchase_no}</Button>
                            {formatDate(a.purchase_date)} · {formatMoney(a.amount)}
                          </Typography>
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">Not matched to any purchase{p.status === 'active' ? ' — kept as an advance' : ''}.</Typography>
                      )}
                      {expanded.notes && <Typography variant="caption" color="text.secondary">{expanded.notes}</Typography>}
                    </TableCell>
                  </TableRow>
                ),
              ].filter(Boolean))}
              {!loading && !data.payments.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No payments found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, pg) => setPage(pg)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {adding && <SupplierPaymentDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {cancelling && <CancelPaymentDialog payment={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); setExpanded(null); load(); }} />}
    </>
  );
}
