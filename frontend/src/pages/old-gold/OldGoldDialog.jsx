import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, MenuItem, ToggleButton, ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CancelDialog from '../../components/CancelDialog';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { todayYmd } from '../../utils/payments';
import CustomerPicker from '../sales/CustomerPicker';
import BankAccountPicker from '../../components/BankAccountPicker';
import { needsBankAccount } from '../../utils/bankAccounts';
import {
  OldGoldLinesEditor, checkLines, emptyOldGoldLine, linesBody, totalOf, useOldGoldSetup,
} from './OldGoldLines';

const PAYOUT = { cash: 'Cash', bank_transfer: 'Bank transfer' };

// Take in a customer's old gold: pay them now, or keep the value on their account
// (it pays what they owe first; the rest is an advance for their next bill).
export function OldGoldDialog({ onClose, onSaved }) {
  const notify = useNotify();
  const { user } = useAuth();
  const { setup, error: setupError } = useOldGoldSetup();
  const [mode, setMode] = useState('credit');
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [form, setForm] = useState({ receipt_date: todayYmd(), payout_method: 'cash', payout_reference: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (setup && !lines.length) setLines([emptyOldGoldLine(setup)]); }, [setup, lines.length]);

  const total = totalOf(lines, setup);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const clearError = (key) => setErrors((x) => ({ ...x, [key]: undefined }));

  const save = async () => {
    const check = checkLines(lines, setup, !!user?.is_super_admin);
    const e = { ...check.errors };
    if (mode === 'credit' && !customer) e.customer = 'Choose the customer to give the credit to';
    const bank = mode === 'cash' && needsBankAccount(form.payout_method);
    if (bank && !form.bank_account_id) e.bank_account_id = 'Choose the bank account';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/old-gold', {
        mode,
        customer_id: customer?.id ?? null,
        receipt_date: form.receipt_date,
        payout_method: form.payout_method,
        payout_reference: form.payout_reference,
        bank_account_id: bank ? form.bank_account_id : null,
        notes: form.notes,
        lines: linesBody(lines),
      });
      notify(`${res.data.receipt_no}: ${formatMoney(res.data.total_value)} ${mode === 'cash' ? 'paid out' : `credited to ${res.data.customer_name}`}`);
      onSaved(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const owes = customer && Number(customer.balance) > 0 ? Number(customer.balance) : 0;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Take in old gold</DialogTitle>
      <DialogContent>
        {!setup && !setupError && <LinearProgress />}
        {(error || setupError) && <Alert severity="error" sx={{ mb: 2 }}>{error || setupError}</Alert>}
        {setup && (
          <Grid container spacing={4}>
            <Grid size={{ xs: 12, md: 7 }}>
              <FormSection title="Pieces" hint={`Valued at today's gram price${Number(setup.deduction_percent) > 0 ? `, less ${setup.deduction_percent}%` : ''}. Each piece goes into stock with a barcode.`}>
                <Grid size={{ xs: 12 }}>
                  <OldGoldLinesEditor lines={lines} onChange={setLines} setup={setup} errors={errors} onClearError={clearError} />
                </Grid>
              </FormSection>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <FormSection title="Give the customer">
                <Grid size={{ xs: 12 }}>
                  <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(e, v) => v && setMode(v)}>
                    <ToggleButton value="credit">Credit / advance</ToggleButton>
                    <ToggleButton value="cash">Pay now</ToggleButton>
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    {mode === 'credit'
                      ? 'The value goes on the customer\'s account: it pays what they owe, and the rest comes off their next bill.'
                      : 'The shop pays the customer the value now.'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); clearError('customer'); }} />
                  {errors.customer && <Typography variant="caption" color="error">{errors.customer}</Typography>}
                  {mode === 'cash' && !customer && <Typography variant="caption" color="text.secondary">Optional when paying now</Typography>}
                </Grid>
                {mode === 'cash' && (
                  <>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField label="Paid by" select value={form.payout_method} onChange={set('payout_method')} fullWidth>
                        {Object.entries(PAYOUT).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}><TextField label="Reference no." value={form.payout_reference} onChange={set('payout_reference')} fullWidth /></Grid>
                    {needsBankAccount(form.payout_method) && (
                      <Grid size={{ xs: 12 }}>
                        <BankAccountPicker label="From account" showBalance value={form.bank_account_id || ''} error={errors.bank_account_id}
                          onChange={(id) => { setForm((f) => ({ ...f, bank_account_id: id })); clearError('bank_account_id'); }} />
                      </Grid>
                    )}
                  </>
                )}
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Date" type="date" value={form.receipt_date} onChange={set('receipt_date')} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
                </Grid>
                <Grid size={{ xs: 12 }}><TextField label="Note" value={form.notes} onChange={set('notes')} multiline minRows={2} fullWidth /></Grid>
              </FormSection>
              <Box sx={{ mt: 2 }}>
                {mode === 'credit' && owes > 0 && total.value > 0 && (
                  <Alert severity="info">
                    {customer.name} owes {formatMoney(owes)}. {formatMoney(Math.min(owes, total.value))} pays that
                    {total.value > owes ? `; ${formatMoney(total.value - owes)} stays as an advance.` : '.'}
                  </Alert>
                )}
              </Box>
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || !setup || !(total.value > 0)}>
          {mode === 'cash' ? `Pay ${formatMoney(total.value)} & print` : `Credit ${formatMoney(total.value)} & print`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// New Sale: the pieces the customer hands in. Nothing is saved until the bill is.
export function OldGoldExchangeDialog({ initial, setup, onClose, onDone }) {
  const { user } = useAuth();
  const [lines, setLines] = useState(initial?.length ? initial : [emptyOldGoldLine(setup)]);
  const [errors, setErrors] = useState({});
  const total = totalOf(lines, setup);
  const done = () => {
    const check = checkLines(lines, setup, !!user?.is_super_admin);
    setErrors(check.errors);
    if (check.ok) onDone(lines);
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Old gold in exchange</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Weigh each piece in front of the customer. Its value at today&apos;s gram price
          {Number(setup.deduction_percent) > 0 ? ` (less ${setup.deduction_percent}%)` : ''} comes off this bill.
        </Typography>
        <OldGoldLinesEditor lines={lines} onChange={setLines} setup={setup} errors={errors} onClearError={(k) => setErrors((x) => ({ ...x, [k]: undefined }))} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={done} disabled={!(total.value > 0)}>Take {formatMoney(total.value)} off the bill</Button>
      </DialogActions>
    </Dialog>
  );
}

// Give the gold back: only while every piece is still in stock.
export function CancelOldGoldDialog({ receipt, onClose, onDone }) {
  return (
    <CancelDialog
      title={`Cancel ${receipt.receipt_no}`}
      url={`/old-gold/${receipt.id}/cancel`}
      intro="Use this when the gold goes back to the customer."
      reasonRequired
      keepText="Keep it"
      confirmText="Cancel receipt"
      onClose={onClose}
      onDone={onDone}
    />
  );
}
