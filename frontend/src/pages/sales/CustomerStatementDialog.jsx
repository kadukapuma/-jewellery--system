import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import api, { errorMessage } from '../../api/client';
import { formatDate, formatMoney } from '../../utils/format';
import TablePager, { usePagedRows } from '../../components/TablePager';

function balanceText(v) {
  if (v > 0) return `owes ${formatMoney(v)}`;
  if (v < 0) return `advance ${formatMoney(-v)}`;
  return 'settled';
}

export default function CustomerStatementDialog({ customerId, onClose, onReceive }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/customers/${customerId}/statement`).then((res) => setData(res.data)).catch((err) => setError(errorMessage(err)));
  }, [customerId]);

  const { pageRows, pager } = usePagedRows(data?.entries);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {data?.customer.name ?? 'Customer'} – statement
        {data && <Typography variant="body2" color="text.secondary">{[data.customer.phone, balanceText(data.closing_balance)].filter(Boolean).join(' · ')}</Typography>}
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
                  <TableCell align="right">Bill</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.page === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Opening balance</TableCell>
                    <TableCell align="right">{formatMoney(data.opening_balance)}</TableCell>
                  </TableRow>
                )}
                {pageRows.map((e) => (
                  <TableRow key={`${e.type}-${e.id}`} hover onClick={e.type === 'sale' ? () => navigate(`/sales/${e.id}`) : undefined}
                    sx={{ cursor: e.type === 'sale' ? 'pointer' : 'default' }}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</TableCell>
                    <TableCell>{e.ref}</TableCell>
                    <TableCell align="right">{e.amount > 0 ? formatMoney(e.amount) : ''}</TableCell>
                    <TableCell align="right">{e.amount < 0 ? formatMoney(-e.amount) : ''}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(e.balance)}</TableCell>
                  </TableRow>
                ))}
                {!data.entries.length && (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>No bills or payments yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <TablePager {...pager} />
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {onReceive && data && <Button variant="contained" onClick={() => onReceive(data.customer)}>Receive payment</Button>}
      </DialogActions>
    </Dialog>
  );
}
