import { useEffect, useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Grid, MenuItem } from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import BankAccountPicker from '../../components/BankAccountPicker';
import { needsBankAccount, refreshBankAccounts } from '../../utils/bankAccounts';

// Records a shop expense (rent, salaries, electricity ...). Paid in cash comes out of cash in hand,
// anything else out of the bank.
export default function ExpenseDialog({ onClose, onSaved }) {
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    expense_date: todayYmd(), category_id: '', paid_to: '', amount: '', method: 'cash', bank_account_id: '', reference_no: '', notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/expenses/categories')
      .then((res) => setCategories(res.data.filter((c) => c.is_active)))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!form.category_id) e.category_id = 'Choose a category';
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount above 0';
    if (!form.expense_date) e.expense_date = 'Enter a date';
    if (needsBankAccount(form.method) && !form.bank_account_id) e.bank_account_id = 'Choose the bank account';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/expenses', {
        ...form, amount: Number(form.amount), bank_account_id: needsBankAccount(form.method) ? form.bank_account_id : null,
      });
      refreshBankAccounts();
      notify(`Expense ${res.data.expense_no} saved`);
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
      <DialogTitle>New expense</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Expense">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('category_id', 'Category', {
              select: true, required: true,
              children: categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>),
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('paid_to', 'Paid to', { placeholder: 'e.g. Electricity board' })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('amount', 'Amount', { required: true, type: 'number', autoFocus: true, slotProps: { htmlInput: { min: 0, step: 'any' } } })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('expense_date', 'Date', { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } })}</Grid>
        </FormSection>
        <FormSection title="Payment">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('method', 'Paid by', {
              select: true,
              helperText: form.method === 'cash' ? 'Comes out of cash in hand' : 'Comes out of the bank account below',
              children: Object.entries(PAYMENT_METHODS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>),
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('reference_no', form.method === 'cheque' ? 'Cheque no.' : 'Bill / reference no.')}</Grid>
          {needsBankAccount(form.method) && (
            <Grid size={{ xs: 12 }}>
              <BankAccountPicker label="From account" showBalance value={form.bank_account_id} error={errors.bank_account_id}
                onChange={(id) => { setForm((f) => ({ ...f, bank_account_id: id })); setErrors((p) => ({ ...p, bank_account_id: undefined })); }} />
            </Grid>
          )}
          <Grid size={{ xs: 12 }}>{field('notes', 'Note', { multiline: true, minRows: 2 })}</Grid>
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save expense</Button>
      </DialogActions>
    </Dialog>
  );
}
