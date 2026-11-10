import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Grid, IconButton, LinearProgress, Link, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import CancelDialog from '../../components/CancelDialog';
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

const bankText = (label) => label || 'Bank (no account)';
const accountText = (e) => {
  if (e.entry_type === 'deposit') return `Cash → ${bankText(e.bank_account_label)}`;
  if (e.entry_type === 'withdrawal') return `${bankText(e.bank_account_label)} → Cash`;
  if (e.entry_type === 'bank_to_bank') return `${bankText(e.bank_account_label)} → ${bankText(e.to_bank_account_label)}`;
  return e.account === 'bank' ? bankText(e.bank_account_label) : ACCOUNTS[e.account];
};

function CancelEntryDialog({ entry, onClose, onDone }) {
  return (
    <CancelDialog
      title={`Cancel ${entry.entry_no}`}
      url={`/finance/cash-entries/${entry.id}/cancel`}
      intro={`${CASH_ENTRY_TYPES[entry.entry_type].label} of ${formatMoney(entry.amount)} (${accountText(entry)}).`}
      reasonPlaceholder="e.g. Wrong amount"
      keepText="Keep entry"
      confirmText="Cancel entry"
      onClose={onClose}
      onDone={onDone}
    />
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
          <StatCard tone="light" label="All bank accounts" note="Card, bank transfer and cheque" value={balances ? formatAmount(Math.round(balances.bank)) : '—'} to="/bank-accounts" />
        </Grid>
        <Grid size={{ xs: 12, sm: 12, lg: 4 }}>
          <StatCard tone="gray" label="Total" note="Cash + bank" value={balances ? formatAmount(Math.round(balances.cash + balances.bank)) : '—'} />
        </Grid>
      </Grid>

      {balances && (balances.accounts.length > 0 || Math.abs(balances.unassigned) >= 0.005) && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>Bank accounts</Typography>
            {can('bank_accounts.manage') && <Button size="small" component={RouterLink} to="/bank-accounts">Manage accounts</Button>}
          </Box>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            {balances.accounts.filter((a) => a.is_active || Math.abs(a.balance) >= 0.005).map((a) => (
              <Grid key={a.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                <StatCard tone="light" label={`${a.bank_name} · ${a.account_name}`} note={[a.account_no, a.branch, !a.is_active && 'inactive'].filter(Boolean).join(' · ')}
                  value={formatAmount(Math.round(a.balance))} />
              </Grid>
            ))}
            {Math.abs(balances.unassigned) >= 0.005 && (
              <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                <StatCard tone="gray" label="Bank (no account)" note="Recorded before bank accounts were set up" value={formatAmount(Math.round(balances.unassigned))} />
              </Grid>
            )}
          </Grid>
        </>
      )}
      {balances && !balances.accounts.length && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No bank accounts set up yet. Add your banks and accounts so card, bank transfer and cheque money is kept per account.{' '}
          {can('bank_accounts.manage') && <Link component={RouterLink} to="/bank-accounts">Set up bank accounts</Link>}
        </Alert>
      )}

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
