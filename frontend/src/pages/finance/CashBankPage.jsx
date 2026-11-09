import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, Grid, IconButton, LinearProgress, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import StatCard from '../../components/StatCard';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import RecordActions from '../../components/RecordActions';
import { formatAmount, formatDate, formatMoney } from '../../utils/format';
import { ACCOUNTS, CASH_ENTRY_TYPES } from '../../utils/finance';
import CashEntryDialog from './CashEntryDialog';

const accountText = (e) => (e.entry_type === 'deposit' ? 'Cash → Bank' : e.entry_type === 'withdrawal' ? 'Bank → Cash' : ACCOUNTS[e.account]);

function CancelEntryDialog({ entry, onClose, onDone }) {
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/finance/cash-entries/${entry.id}/cancel`, { reason });
      notify(`${entry.entry_no} cancelled`);
      onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel {entry.entry_no}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {CASH_ENTRY_TYPES[entry.entry_type].label} of {formatMoney(entry.amount)} ({accountText(entry)}). The balances will be worked out again without it.
        </Typography>
        <TextField label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep entry</Button>
        <Button variant="contained" color="error" onClick={cancel} disabled={busy}>Cancel entry</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CashBankPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [balances, setBalances] = useState(null);
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, entries: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, list] = await Promise.all([
        api.get('/finance/balances'),
        api.get('/finance/cash-entries', { params: { status, page, page_size: pageSize } }),
      ]);
      setBalances(b.data);
      setData(list.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        title="Cash & Bank"
        subtitle="Money in hand and in the bank, opening balances, owner capital and transfers"
        actions={can('cash_entries.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>New entry</Button>}
      />
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard tone="gold" label={ACCOUNTS.cash} note="Everything paid or received in cash" value={balances ? formatAmount(Math.round(balances.cash)) : '—'} to="/finance" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard tone="light" label={ACCOUNTS.bank} note="Card, bank transfer and cheque" value={balances ? formatAmount(Math.round(balances.bank)) : '—'} to="/finance" />
        </Grid>
        <Grid size={{ xs: 12, sm: 12, lg: 4 }}>
          <StatCard tone="gray" label="Total" note="Cash + bank" value={balances ? formatAmount(Math.round(balances.cash + balances.bank)) : '—'} />
        </Grid>
      </Grid>

      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 600 }}>Entries</Typography>
          <Box sx={{ flexGrow: 1 }} />
          <TextField select label="Status" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }} sx={{ width: 140 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Entry</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Account</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>By</TableCell>
                <TableCell>Status</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.entries.map((e) => (
                <TableRow key={e.id} hover sx={{ opacity: e.status === 'cancelled' ? 0.55 : 1 }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.entry_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {e.entry_no}
                    {e.notes && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{e.notes}</Typography>}
                  </TableCell>
                  <TableCell>{CASH_ENTRY_TYPES[e.entry_type]?.label}</TableCell>
                  <TableCell>{accountText(e)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(e.amount)}</TableCell>
                  <TableCell>{e.created_by_name}</TableCell>
                  <TableCell>{e.status === 'cancelled' ? <Chip size="small" label="Cancelled" /> : <Chip size="small" color="success" variant="outlined" label="Active" />}</TableCell>
                  <TableCell align="right">
                    {can('cash_entries.cancel') && e.status === 'active' && (
                      <Tooltip title="Cancel entry"><IconButton size="small" onClick={() => setCancelling(e)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    <RecordActions record={e} label={e.entry_no} url={`/finance/cash-entries/${e.id}`} module="cash_entries"
                      fields={[{ name: 'notes', label: 'Notes' }]} onDone={load} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.entries.length && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    No entries yet. Start with an opening balance for cash in hand and for the bank.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, pg) => setPage(pg)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {adding && <CashEntryDialog balances={balances} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {cancelling && <CancelEntryDialog entry={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); load(); }} />}
    </>
  );
}
