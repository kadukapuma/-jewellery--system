import { useEffect, useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import api, { errorMessage } from '../../api/client';
import { formatDate, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS } from '../../utils/payments';
import TablePager, { usePagedRows } from '../../components/TablePager';

function balanceText(v) {
  if (v > 0) return `${formatMoney(v)} owed`;
  if (v < 0) return `${formatMoney(-v)} advance`;
  return 'Settled';
}

export default function SupplierStatementDialog({ supplierId, onClose, onPay }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/suppliers/${supplierId}/statement`).then((res) => setData(res.data)).catch((err) => setError(errorMessage(err)));
  }, [supplierId]);

  const { pageRows, pager } = usePagedRows(data?.entries);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Statement – {data?.supplier.name}
        {data && <Typography color="text.secondary" variant="body2">Balance: {balanceText(data.closing_balance)}</Typography>}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {!data && !error && <LinearProgress />}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {data && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Details</TableCell>
                  <TableCell align="right">Purchase</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.page === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>Opening balance</TableCell>
                    <TableCell align="right">{formatMoney(data.opening_balance)}</TableCell>
                  </TableRow>
                )}
                {pageRows.map((e) => (
                  <TableRow key={`${e.type}-${e.id}`} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</TableCell>
                    <TableCell>{e.ref}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {e.type === 'payment' ? (PAYMENT_METHODS[e.detail?.split(' · ')[0]] || '') + (e.detail?.includes(' · ') ? ` · ${e.detail.split(' · ')[1]}` : '') : e.detail && `Invoice ${e.detail}`}
                    </TableCell>
                    <TableCell align="right">{e.amount > 0 ? formatMoney(e.amount) : ''}</TableCell>
                    <TableCell align="right">{e.amount < 0 ? formatMoney(-e.amount) : ''}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(e.balance)}</TableCell>
                  </TableRow>
                ))}
                {!data.entries.length && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>No purchases or payments yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <TablePager {...pager} />
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {onPay && <Button variant="contained" onClick={onPay}>Pay supplier</Button>}
      </DialogActions>
    </Dialog>
  );
}
