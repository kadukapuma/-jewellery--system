import { useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Grid, MenuItem } from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import BankAccountPicker from '../../components/BankAccountPicker';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { todayYmd } from '../../utils/payments';
import { ACCOUNTS, CASH_ENTRY_TYPES } from '../../utils/finance';
import { refreshBankAccounts, useBankAccounts } from '../../utils/bankAccounts';

// Money that is not a sale, purchase or expense: opening balances, owner capital / drawings,
// cash <-> bank and bank <-> bank transfers. Bank money always names the bank account.
export default function CashEntryDialog({ balances, onClose, onSaved }) {
  const notify = useNotify();
  const { accounts } = useBankAccounts();
  const [form, setForm] = useState({
    entry_date: todayYmd(), entry_type: 'opening', account: 'cash', bank_account_id: '', to_bank_account_id: '', amount: '', notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const type = CASH_ENTRY_TYPES[form.entry_type];
  const t = form.entry_type;

  // Which bank account fields this entry needs.
  const isTransfer = t === 'bank_to_bank';
  const usesBank = t === 'deposit' || t === 'withdrawal' || isTransfer || (type.pickAccount && form.account === 'bank');
  const bankLabel = { deposit: 'Into account', withdrawal: 'From account', bank_to_bank: 'From account' }[t] || 'Account';

  // What money leaves, and how much is there: { label, balance } or null.
  const bankBalance = (id) => accounts.find((a) => a.id === Number(id))?.balance ?? null;
  let takenFrom = null;
  if (t === 'deposit' || (t === 'drawing' && form.account === 'cash')) takenFrom = balances ? { label: ACCOUNTS.cash.toLowerCase(), balance: balances.cash } : null;
  else if ((t === 'withdrawal' || isTransfer || (t === 'drawing' && form.account === 'bank')) && form.bank_account_id) {
    takenFrom = { label: 'that bank account', balance: bankBalance(form.bank_account_id) };
  }

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const setId = (field) => (id) => {
    setForm((f) => ({ ...f, [field]: id }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount above 0';
    else if (takenFrom && takenFrom.balance != null && Number(form.amount) > takenFrom.balance) e.amount = `Only ${formatMoney(takenFrom.balance)} in ${takenFrom.label}`;
    if (!form.entry_date) e.entry_date = 'Enter a date';
    if (usesBank && !form.bank_account_id) e.bank_account_id = 'Choose the bank account';
    if (isTransfer && !form.to_bank_account_id) e.to_bank_account_id = 'Choose the account to put the money into';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/finance/cash-entries', {
        ...form,
        amount: Number(form.amount),
        bank_account_id: usesBank ? form.bank_account_id : null,
        to_bank_account_id: isTransfer ? form.to_bank_account_id : null,
      });
      refreshBankAccounts();
      notify(`Entry ${res.data.entry_no} saved`);
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
      <DialogTitle>New cash / bank entry</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Entry" hint={type.hint}>
          <Grid size={{ xs: 12, sm: type.pickAccount ? 6 : 12 }}>
            {field('entry_type', 'Type', {
              select: true,
              children: Object.entries(CASH_ENTRY_TYPES).map(([v, x]) => <MenuItem key={v} value={v}>{x.label}</MenuItem>),
            })}
          </Grid>
          {type.pickAccount && (
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('account', 'Cash or bank', {
                select: true,
                helperText: balances && form.account === 'cash' ? `Now: ${formatMoney(balances.cash)}` : undefined,
                children: Object.entries(ACCOUNTS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>),
              })}
            </Grid>
          )}
          {usesBank && (
            <Grid size={{ xs: 12 }}>
              <BankAccountPicker label={bankLabel} showBalance value={form.bank_account_id} error={errors.bank_account_id}
                onChange={setId('bank_account_id')} />
            </Grid>
          )}
          {isTransfer && (
            <Grid size={{ xs: 12 }}>
              <BankAccountPicker label="Into account" bankLabel="To bank" showBalance value={form.to_bank_account_id}
                excludeId={form.bank_account_id || null} error={errors.to_bank_account_id} onChange={setId('to_bank_account_id')} />
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('amount', 'Amount', {
              required: true, type: 'number', autoFocus: true, slotProps: { htmlInput: { min: 0, step: 'any' } },
              helperText: takenFrom && takenFrom.balance != null ? `Available in ${takenFrom.label}: ${formatMoney(takenFrom.balance)}` : undefined,
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('entry_date', 'Date', { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } })}</Grid>
          <Grid size={{ xs: 12 }}>{field('notes', 'Note', { multiline: true, minRows: 2, placeholder: t === 'deposit' || isTransfer ? 'e.g. Bank slip no.' : undefined })}</Grid>
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save entry</Button>
      </DialogActions>
    </Dialog>
  );
}
