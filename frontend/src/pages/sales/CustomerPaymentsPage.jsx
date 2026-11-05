import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDateTime, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS } from '../../utils/payments';
import ReceivePaymentDialog from './ReceivePaymentDialog';

function CancelReceiptDialog({ payment, onClose, onDone }) {
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/customer-payments/${payment.id}/cancel`, { reason });
      notify(`${payment.receipt_no} cancelled`);
      onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel {payment.receipt_no}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {formatMoney(payment.amount)} from {payment.customer_name || 'walk-in'}. The bills it paid will show as owed again.
        </Typography>
        <TextField label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep receipt</Button>
        <Button variant="contained" color="error" onClick={cancel} disabled={busy}>Cancel receipt</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CustomerPaymentsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: 'active', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sum_amount: 0, payments: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/customer-payments', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key) => (e) => { setPage(0); setFilters((f) => ({ ...f, [key]: e.target.value })); };

  const toggle = async (p) => {
    if (expanded?.id === p.id) { setExpanded(null); return; }
    try {
      const res = await api.get(`/customer-payments/${p.id}`);
      setExpanded(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Money received from customers – at the counter and later"
        actions={can('customer_payments.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Receive payment</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select label="Status" value={filters.status} onChange={setFilter('status')} sx={{ width: 140 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={setFilter('from')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="To" type="date" value={filters.to} onChange={setFilter('to')} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">{data.total} receipt(s) · {formatMoney(data.sum_amount)}</Typography>
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Receipt</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Paid by</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Advance left</TableCell>
                <TableCell>Status</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.payments.flatMap((p) => [
                <TableRow key={p.id} hover onClick={() => toggle(p)} sx={{ cursor: 'pointer', opacity: p.status === 'cancelled' ? 0.55 : 1 }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(p.payment_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {p.receipt_no}
                    {p.counter_invoice_no && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>with {p.counter_invoice_no}</Typography>}
                  </TableCell>
                  <TableCell>{p.customer_name || <Typography variant="body2" color="text.secondary">Walk-in</Typography>}</TableCell>
                  <TableCell>{PAYMENT_METHODS[p.method]}{p.reference_no ? ` · ${p.reference_no}` : ''}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(p.amount)}</TableCell>
                  <TableCell align="right">{p.status === 'active' && p.unallocated > 0 ? formatMoney(p.unallocated) : '—'}</TableCell>
                  <TableCell>{p.status === 'cancelled' ? <Chip size="small" label="Cancelled" /> : <Chip size="small" color="success" variant="outlined" label="Active" />}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {can('customer_payments.cancel') && p.status === 'active' && !p.sale_id && (
                      <Tooltip title="Cancel receipt"><IconButton size="small" onClick={() => setCancelling(p)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>,
                expanded?.id === p.id && (
                  <TableRow key={`${p.id}-d`}>
                    <TableCell colSpan={8} sx={{ bgcolor: 'action.hover' }}>
                      {expanded.allocations.length ? expanded.allocations.map((a) => (
                        <Typography key={a.sale_id} variant="body2">
                          <Button size="small" sx={{ p: 0, minWidth: 0, mr: 1 }} onClick={() => navigate(`/sales/${a.sale_id}`)}>{a.invoice_no}</Button>
                          {formatMoney(a.amount)}
                        </Typography>
                      )) : <Typography variant="body2" color="text.secondary">Not put on any bill{p.status === 'active' ? ' — kept as the customer’s advance' : ''}.</Typography>}
                      {p.sale_id && <Typography variant="caption" color="text.secondary">Taken with the bill – cancel the bill to refund it.</Typography>}
                      {expanded.notes && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{expanded.notes}</Typography>}
                    </TableCell>
                  </TableRow>
                ),
              ].filter(Boolean))}
              {!loading && !data.payments.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No receipts found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, pg) => setPage(pg)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {adding && <ReceivePaymentDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {cancelling && <CancelReceiptDialog payment={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); setExpanded(null); load(); }} />}
    </>
  );
}
