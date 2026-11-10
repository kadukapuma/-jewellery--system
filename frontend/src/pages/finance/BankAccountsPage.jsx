import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton,
  LinearProgress, MenuItem, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import PageHeader from '../../components/PageHeader';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { refreshBankAccounts } from '../../utils/bankAccounts';

// Add or rename a bank, or stop using it.
function BankDialog({ bank, onClose, onSaved }) {
  const [form, setForm] = useState({ name: bank?.name || '', is_active: bank ? bank.is_active : true });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.name.trim()) { setErrors({ name: 'Enter the bank name' }); return; }
    setBusy(true);
    setError('');
    try {
      const res = bank ? await api.put(`/bank-accounts/banks/${bank.id}`, form) : await api.post('/bank-accounts/banks', form);
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{bank ? 'Edit bank' : 'New bank'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ pt: 1, display: 'grid', gap: 2 }}>
          <TextField label="Bank name" autoFocus required value={form.name} placeholder="e.g. Bank of Ceylon"
            onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({}); }} error={!!errors.name} helperText={errors.name} />
          {bank && (
            <FormControlLabel control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
              label={form.is_active ? 'In use' : 'Not in use (its accounts cannot be chosen)'} />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save bank</Button>
      </DialogActions>
    </Dialog>
  );
}

// Add or change an account at one of the banks.
function AccountDialog({ account, banks, onClose, onSaved, onAddBank }) {
  const [form, setForm] = useState({
    bank_id: account?.bank_id ?? (banks.filter((b) => b.is_active).length === 1 ? banks.find((b) => b.is_active).id : ''),
    account_name: account?.account_name || '',
    account_no: account?.account_no || '',
    branch: account?.branch || '',
    is_active: account ? account.is_active : true,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    const e = {};
    if (!form.bank_id) e.bank_id = 'Choose the bank';
    if (!form.account_name.trim()) e.account_name = 'Enter a name for the account';
    if (!form.account_no.trim()) e.account_no = 'Enter the account number';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError('');
    try {
      const res = account ? await api.put(`/bank-accounts/${account.id}`, form) : await api.post('/bank-accounts', form);
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (name, label, props = {}) => (
    <TextField label={label} value={form[name]} onChange={set(name)} {...props} error={!!errors[name]} helperText={errors[name] || props.helperText} />
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{account ? 'Edit bank account' : 'New bank account'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                {field('bank_id', 'Bank', {
                  select: true, required: true,
                  children: banks.filter((b) => b.is_active || b.id === form.bank_id).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>),
                })}
              </Box>
              <Button variant="outlined" onClick={onAddBank} sx={{ mt: 0.5 }}>New bank</Button>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('account_name', 'Account name', { required: true, placeholder: 'e.g. Current account' })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('account_no', 'Account number', { required: true })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('branch', 'Branch')}</Grid>
          {account && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel control={<Switch checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
                label={form.is_active ? 'In use' : 'Not in use'} />
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save account</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function BankAccountsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const manage = can('bank_accounts.manage');
  const [banks, setBanks] = useState([]);
  const [data, setData] = useState({ accounts: [], unassigned: 0, bank: 0 });
  const [loading, setLoading] = useState(true);
  const [editingBank, setEditingBank] = useState(null); // {} = new
  const [editingAccount, setEditingAccount] = useState(null); // {} = new

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([api.get('/bank-accounts/banks'), api.get('/bank-accounts')]);
      setBanks(b.data);
      setData(a.data);
      refreshBankAccounts();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const bankSaved = (bank) => {
    notify(`${bank.name} saved`);
    setEditingBank(null);
    load();
  };
  const accountSaved = (acc) => {
    notify(`${acc.bank_name} · ${acc.account_name} saved`);
    setEditingAccount(null);
    load();
  };

  return (
    <>
      <PageHeader
        title="Bank Accounts"
        subtitle="The shop's banks and accounts. Card, bank transfer and cheque money is recorded in one of these."
        actions={manage && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditingBank({})}>New bank</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => (banks.length ? setEditingAccount({}) : setEditingBank({}))}>New account</Button>
          </Box>
        )}
      />

      {!loading && !banks.length && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Start by adding your banks, then add the accounts you hold at each one.
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card>
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>Accounts</Typography>
              <Typography variant="body2" color="text.secondary">All banks: {formatMoney(data.bank)}</Typography>
            </Box>
            {loading && <LinearProgress />}
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Bank</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Number</TableCell>
                    <TableCell>Branch</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.accounts.map((a) => (
                    <TableRow key={a.id} hover sx={{ opacity: a.is_active ? 1 : 0.55 }}>
                      <TableCell>{a.bank_name}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{a.account_name}</TableCell>
                      <TableCell>{a.account_no}</TableCell>
                      <TableCell>{a.branch || '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(a.balance)}</TableCell>
                      <TableCell>{a.is_active ? <Chip size="small" color="success" variant="outlined" label="In use" /> : <Chip size="small" label="Not in use" />}</TableCell>
                      <TableCell align="right">
                        {manage && <Tooltip title="Edit account"><IconButton size="small" onClick={() => setEditingAccount(a)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {Math.abs(data.unassigned) >= 0.005 && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Bank money recorded before accounts were set up</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(data.unassigned)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                  {!loading && !data.accounts.length && (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>No bank accounts yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card>
            <Box sx={{ p: 2 }}><Typography sx={{ fontWeight: 600 }}>Banks</Typography></Box>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  {banks.map((b) => (
                    <TableRow key={b.id} hover sx={{ opacity: b.is_active ? 1 : 0.55 }}>
                      <TableCell sx={{ fontWeight: 600 }}>{b.name}</TableCell>
                      <TableCell>{b.account_count} {b.account_count === 1 ? 'account' : 'accounts'}</TableCell>
                      <TableCell align="right">
                        {!b.is_active && <Chip size="small" label="Not in use" sx={{ mr: 1 }} />}
                        {manage && <Tooltip title="Edit bank"><IconButton size="small" onClick={() => setEditingBank(b)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && !banks.length && (
                    <TableRow><TableCell align="center" sx={{ py: 4, color: 'text.secondary' }}>No banks yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>

      {editingBank && <BankDialog bank={editingBank.id ? editingBank : null} onClose={() => setEditingBank(null)} onSaved={bankSaved} />}
      {editingAccount && (
        <AccountDialog
          account={editingAccount.id ? editingAccount : null}
          banks={banks}
          onClose={() => setEditingAccount(null)}
          onSaved={accountSaved}
          onAddBank={() => setEditingBank({})}
        />
      )}
    </>
  );
}
