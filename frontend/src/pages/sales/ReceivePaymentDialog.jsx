import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatDate, formatMoney } from '../../utils/format';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import { stone } from '../../theme';
import CustomerPicker from './CustomerPicker';
import TablePager, { usePagedRows } from '../../components/TablePager';

// Money from a customer for credit bills / instalments. Settles the chosen bill first, then the oldest.
export default function ReceivePaymentDialog({ customer: initialCustomer, sale, onClose, onSaved }) {
  const notify = useNotify();
  const [customer, setCustomer] = useState(initialCustomer || (sale ? { id: sale.customer_id, name: sale.customer_name, balance: null } : null));
  const [openBills, setOpenBills] = useState([]);
  const [form, setForm] = useState({
    payment_date: todayYmd(), amount: sale ? sale.balance : '', method: 'cash', reference_no: '', cheque_date: '', notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer) { setOpenBills([]); return undefined; }
    let active = true;
    Promise.all(['unpaid', 'partial'].map((s) => api.get('/sales', { params: { customer_id: customer.id, payment_status: s, page_size: 200 } })))
      .then((res) => {
        if (!active) return;
        setOpenBills(res.flatMap((r) => r.data.sales).sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.id - b.id));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [customer]);

  const plan = useMemo(() => {
    let left = Number(form.amount) || 0;
    const ordered = sale ? [...openBills].sort((a, b) => (b.id === sale.id) - (a.id === sale.id)) : openBills;
    const rows = [];
    for (const s of ordered) {
      if (left <= 0) break;
      const share = Math.min(left, Number(s.balance));
      rows.push({ ...s, share });
      left = Math.round((left - share) * 100) / 100;
    }
    return { rows, advance: left };
  }, [form.amount, openBills, sale]);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!customer) e.customer = 'Choose a customer';
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount above 0';
    setErrors(e);
    if (Object.keys(e).length) { if (e.customer) setError(e.customer); return; }
    setBusy(true);
    try {
      const res = await api.post('/customer-payments', {
        ...form, customer_id: customer.id, amount: Number(form.amount),
        cheque_date: form.method === 'cheque' ? form.cheque_date : null, sale_id: sale?.id ?? null,
      });
      notify(`Receipt ${res.data.receipt_no} saved`);
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

  const { pageRows, pager } = usePagedRows(plan.rows);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Receive payment
        {sale && <Typography variant="body2" color="text.secondary">For {sale.invoice_no} · balance {formatMoney(sale.balance)}</Typography>}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormSection title="From">
              <Grid size={{ xs: 12 }}>
                {initialCustomer || sale
                  ? <TextField label="Customer" value={customer?.name || ''} disabled />
                  : <CustomerPicker value={customer} onChange={setCustomer} />}
              </Grid>
            </FormSection>
            <FormSection title="Payment">
              <Grid size={{ xs: 12, sm: 6 }}>{field('amount', 'Amount', { required: true, type: 'number', autoFocus: true, slotProps: { htmlInput: { min: 0, step: 'any' } } })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{field('payment_date', 'Date', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('method', 'Paid by', { select: true, children: Object.entries(PAYMENT_METHODS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>) })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{field('reference_no', form.method === 'cheque' ? 'Cheque no.' : 'Reference no.')}</Grid>
              {form.method === 'cheque' && <Grid size={{ xs: 12, sm: 6 }}>{field('cheque_date', 'Cheque date', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}</Grid>}
              <Grid size={{ xs: 12 }}>{field('notes', 'Note', { multiline: true, minRows: 2 })}</Grid>
            </FormSection>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ bgcolor: stone[50], borderRadius: '20px', p: 2.5, height: '100%' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>This payment will settle</Typography>
              {!(Number(form.amount) > 0 && customer) ? (
                <Typography variant="body2" color="text.secondary">Choose the customer and enter the amount to see which bills it pays.</Typography>
              ) : plan.rows.length ? (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow><TableCell>Bill</TableCell><TableCell>Date</TableCell><TableCell align="right">Balance</TableCell><TableCell align="right">Pays</TableCell></TableRow>
                    </TableHead>
                    <TableBody>
                      {pageRows.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.invoice_no}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(s.sale_date)}</TableCell>
                          <TableCell align="right">{formatMoney(s.balance)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(s.share)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePager {...pager} rowsPerPageOptions={[]} />
                </>
              ) : <Typography variant="body2" color="text.secondary">No unpaid bills.</Typography>}
              {Number(form.amount) > 0 && customer && plan.advance > 0 && (
                <Alert severity="info" sx={{ mt: 1 }}>{formatMoney(plan.advance)} will be kept as the customer’s advance for the next bill.</Alert>
              )}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save receipt</Button>
      </DialogActions>
    </Dialog>
  );
}
