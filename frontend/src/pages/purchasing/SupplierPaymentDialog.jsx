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
import TablePager, { usePagedRows } from '../../components/TablePager';

// Records a payment to a supplier. It settles the chosen purchase first, then the oldest unpaid ones;
// anything left over stays as an advance and is used on the next purchase.
export default function SupplierPaymentDialog({ supplierId: initialSupplierId, purchase, onClose, onSaved }) {
  const notify = useNotify();
  const [suppliers, setSuppliers] = useState([]);
  const [openPurchases, setOpenPurchases] = useState([]);
  const [form, setForm] = useState({
    supplier_id: initialSupplierId || purchase?.supplier_id || '',
    payment_date: todayYmd(),
    amount: purchase ? purchase.balance : '',
    method: 'cash',
    reference_no: '',
    cheque_date: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!form.supplier_id) { setOpenPurchases([]); return undefined; }
    let active = true;
    Promise.all([
      api.get('/purchases', { params: { supplier_id: form.supplier_id, payment_status: 'unpaid', page_size: 200 } }),
      api.get('/purchases', { params: { supplier_id: form.supplier_id, payment_status: 'partial', page_size: 200 } }),
    ])
      .then(([a, b]) => {
        if (!active) return;
        const list = [...a.data.purchases, ...b.data.purchases].sort((x, y) => x.purchase_date.localeCompare(y.purchase_date) || x.id - y.id);
        setOpenPurchases(list);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [form.supplier_id]);

  const supplier = suppliers.find((s) => s.id === form.supplier_id);

  // Same order the server uses: chosen purchase first, then oldest.
  const plan = useMemo(() => {
    let left = Number(form.amount) || 0;
    const ordered = purchase ? [...openPurchases].sort((a, b) => (b.id === purchase.id) - (a.id === purchase.id)) : openPurchases;
    const rows = [];
    for (const p of ordered) {
      if (left <= 0) break;
      const share = Math.min(left, Number(p.balance));
      rows.push({ ...p, share });
      left = Math.round((left - share) * 100) / 100;
    }
    return { rows, advance: left };
  }, [form.amount, openPurchases, purchase]);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!form.supplier_id) e.supplier_id = 'Choose a supplier';
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount above 0';
    if (!form.payment_date) e.payment_date = 'Enter a date';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/supplier-payments', {
        ...form,
        amount: Number(form.amount),
        cheque_date: form.method === 'cheque' ? form.cheque_date : null,
        purchase_id: purchase?.id ?? null,
      });
      notify(`Payment ${res.data.payment_no} saved`);
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
        Pay supplier
        {purchase && <Typography variant="body2" color="text.secondary">For {purchase.purchase_no} · balance {formatMoney(purchase.balance)}</Typography>}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormSection title="To">
              <Grid size={{ xs: 12 }}>
                {field('supplier_id', 'Supplier', {
                  select: true, required: true, disabled: !!purchase || !!initialSupplierId,
                  helperText: supplier ? `Owed now: ${formatMoney(supplier.balance)}` : undefined,
                  children: suppliers.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>),
                })}
              </Grid>
            </FormSection>
            <FormSection title="Payment">
              <Grid size={{ xs: 12, sm: 6 }}>{field('amount', 'Amount', { required: true, type: 'number', autoFocus: true, slotProps: { htmlInput: { min: 0, step: 'any' } } })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{field('payment_date', 'Date', { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('method', 'Paid by', { select: true, children: Object.entries(PAYMENT_METHODS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>) })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{field('reference_no', form.method === 'cheque' ? 'Cheque no.' : 'Reference no.')}</Grid>
              {form.method === 'cheque' && (
                <Grid size={{ xs: 12, sm: 6 }}>{field('cheque_date', 'Cheque date', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}</Grid>
              )}
              <Grid size={{ xs: 12 }}>{field('notes', 'Note', { multiline: true, minRows: 2 })}</Grid>
            </FormSection>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ bgcolor: stone[50], borderRadius: '20px', p: 2.5, height: '100%' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>This payment will settle</Typography>
              {!(Number(form.amount) > 0 && form.supplier_id) ? (
                <Typography variant="body2" color="text.secondary">Choose the supplier and enter the amount to see which purchases it pays.</Typography>
              ) : plan.rows.length > 0 ? (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Purchase</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">Balance</TableCell>
                        <TableCell align="right">Pays</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pageRows.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.purchase_no}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(p.purchase_date)}</TableCell>
                          <TableCell align="right">{formatMoney(p.balance)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(p.share)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePager {...pager} rowsPerPageOptions={[]} />
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">No unpaid purchases.</Typography>
              )}
              {Number(form.amount) > 0 && form.supplier_id && plan.advance > 0 && (
                <Alert severity="info" sx={{ mt: 1 }}>{formatMoney(plan.advance)} will be kept as an advance and used on the next purchase.</Alert>
              )}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save payment</Button>
      </DialogActions>
    </Dialog>
  );
}
