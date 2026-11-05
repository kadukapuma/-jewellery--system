import { useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Grid, MenuItem } from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { todayYmd } from '../../utils/payments';
import { ACCOUNTS, CASH_ENTRY_TYPES } from '../../utils/finance';

// Money that is not a sale, purchase or expense: opening balances, owner capital / drawings, cash <-> bank transfers.
export default function CashEntryDialog({ balances, onClose, onSaved }) {
  const notify = useNotify();
  const [form, setForm] = useState({ entry_date: todayYmd(), entry_type: 'opening', account: 'cash', amount: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const type = CASH_ENTRY_TYPES[form.entry_type];
  const takenFrom = { drawing: form.account, deposit: 'cash', withdrawal: 'bank' }[form.entry_type];

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount above 0';
    else if (takenFrom && balances && Number(form.amount) > balances[takenFrom]) e.amount = `Only ${formatMoney(balances[takenFrom])} in ${ACCOUNTS[takenFrom].toLowerCase()}`;
    if (!form.entry_date) e.entry_date = 'Enter a date';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/finance/cash-entries', { ...form, amount: Number(form.amount) });
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
              children: Object.entries(CASH_ENTRY_TYPES).map(([v, t]) => <MenuItem key={v} value={v}>{t.label}</MenuItem>),
            })}
          </Grid>
          {type.pickAccount && (
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('account', 'Account', {
                select: true,
                helperText: balances ? `Now: ${formatMoney(balances[form.account])}` : undefined,
                children: Object.entries(ACCOUNTS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>),
              })}
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('amount', 'Amount', {
              required: true, type: 'number', autoFocus: true, slotProps: { htmlInput: { min: 0, step: 'any' } },
              helperText: takenFrom && balances ? `Available in ${ACCOUNTS[takenFrom].toLowerCase()}: ${formatMoney(balances[takenFrom])}` : undefined,
            })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('entry_date', 'Date', { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } })}</Grid>
          <Grid size={{ xs: 12 }}>{field('notes', 'Note', { multiline: true, minRows: 2, placeholder: form.entry_type === 'deposit' ? 'e.g. Bank slip no.' : undefined })}</Grid>
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save entry</Button>
      </DialogActions>
    </Dialog>
  );
}
