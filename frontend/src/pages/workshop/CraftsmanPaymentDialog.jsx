import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import BankAccountPicker from '../../components/BankAccountPicker';
import { needsBankAccount, refreshBankAccounts } from '../../utils/bankAccounts';

const METHODS = ['cash', 'bank_transfer', 'cheque'];

export default function CraftsmanPaymentDialog({ craftsman, onClose, onSaved }) {
  const notify = useNotify();
  const [form, setForm] = useState({
    payment_date: todayYmd(),
    amount: craftsman.cash_due > 0 ? craftsman.cash_due : '',
    method: 'cash',
    bank_account_id: '',
    reference_no: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    if (!(Number(form.amount) > 0)) {
      setErrors({ amount: 'Enter an amount above 0' });
      return;
    }
    const bank = needsBankAccount(form.method);
    if (bank && !form.bank_account_id) {
      setErrors({ bank_account_id: 'Choose the bank account' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/craftsman-payments', {
        ...form, craftsman_id: craftsman.id, amount: Number(form.amount), bank_account_id: bank ? form.bank_account_id : null,
      });
      refreshBankAccounts();
      notify(`Payment ${res.data.payment_no} saved`);
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const after = Math.round((craftsman.cash_due - (Number(form.amount) || 0)) * 100) / 100;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Pay {craftsman.name}
        <Typography variant="body2" color="text.secondary">
          {craftsman.cash_due >= 0 ? `Fees owed: ${formatMoney(craftsman.cash_due)}` : `Advance already paid: ${formatMoney(-craftsman.cash_due)}`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 6 }}>
            <TextField label="Amount" type="number" autoFocus value={form.amount} onChange={set('amount')} error={!!errors.amount}
              helperText={errors.amount || (after < 0 ? `${formatMoney(-after)} will be an advance` : `${formatMoney(after)} still owed`)}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Date" type="date" value={form.payment_date} onChange={set('payment_date')} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField select label="Paid by" value={form.method} onChange={set('method')}>
              {METHODS.map((m) => <MenuItem key={m} value={m}>{PAYMENT_METHODS[m]}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6 }}><TextField label="Reference no." value={form.reference_no} onChange={set('reference_no')} /></Grid>
          {needsBankAccount(form.method) && (
            <Grid size={{ xs: 12 }}>
              <BankAccountPicker label="From account" showBalance value={form.bank_account_id} error={errors.bank_account_id}
                onChange={(id) => { setForm((f) => ({ ...f, bank_account_id: id })); setErrors((p) => ({ ...p, bank_account_id: undefined })); }} />
            </Grid>
          )}
          <Grid size={{ xs: 12 }}><TextField label="Note" value={form.notes} onChange={set('notes')} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save payment</Button>
      </DialogActions>
    </Dialog>
  );
}
