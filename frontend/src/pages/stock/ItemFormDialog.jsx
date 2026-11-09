import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment,
  MenuItem, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { calcItemPrice, formatWeight } from '../../utils/pricing';
import { gold, stone } from '../../theme';
import PriceRangeFields, { priceRangeErrors } from '../../components/PriceRangeFields';

export default function ItemFormDialog({ item, categories, karats, onClose, onSaved }) {
  const isNew = !item;
  const { can } = useAuth();
  const notify = useNotify();
  const [form, setForm] = useState({
    name: item?.name || '',
    item_code: item?.item_code || '',
    category_id: item?.category_id || '',
    karat_id: item?.karat_id || '',
    net_weight_g: item?.net_weight_g ?? '',
    wastage_g: item?.wastage_g ?? 0,
    making_charge: item?.making_charge ?? 0,
    price_min_percent: Number(item?.price_min_percent ?? 0),
    price_max_percent: Number(item?.price_max_percent ?? 0),
    cost_price: item?.cost_price ?? '',
    stock_qty: item?.stock_qty ?? 1,
    status: item?.status === 'inactive' ? 'inactive' : 'in_stock',
    description: item?.description || '',
  });
  const [printAfter, setPrintAfter] = useState(true);
  const [prices, setPrices] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canCost = can('items.view_cost');
  const biscuit = categories.find((c) => c.id === form.category_id)?.category_type === 'biscuit';

  useEffect(() => {
    if (!can('gold_prices.view')) return;
    api.get('/gold-prices/current').then((res) => setPrices(res.data.prices)).catch(() => {});
  }, [can]);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const gramPrice = prices.find((p) => p.karat_id === form.karat_id)?.gram_price ?? null;
  const preview = Number(form.net_weight_g) > 0 && gramPrice !== null ? calcItemPrice(form, gramPrice) : null;
  const final = preview?.line_total ?? null;

  const setPercent = (field, percent) => {
    setForm((f) => ({ ...f, [field]: percent }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const cost = canCost && form.cost_price !== '' ? Number(form.cost_price) : null;

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.category_id) e.category_id = 'Choose a category';
    if (!form.karat_id) e.karat_id = 'Choose a karat';
    if (!(Number(form.net_weight_g) > 0)) e.net_weight_g = 'Enter the weight in grams';
    if (Number(form.wastage_g) < 0) e.wastage_g = 'Cannot be negative';
    if (Number(form.making_charge) < 0) e.making_charge = 'Cannot be negative';
    if (!Number.isInteger(Number(form.stock_qty)) || Number(form.stock_qty) < 0) e.stock_qty = 'Whole number, 0 or more';
    if (!isNew && !form.item_code.trim()) e.item_code = 'Code is required';
    return { ...e, ...priceRangeErrors(form.price_min_percent, form.price_max_percent) };
  };

  const save = async () => {
    setError('');
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const body = {
      ...form,
      wastage_g: form.wastage_g === '' ? 0 : form.wastage_g,
      making_charge: form.making_charge === '' ? 0 : form.making_charge,
      cost_price: canCost && form.cost_price !== '' ? form.cost_price : undefined,
    };
    if (isNew) delete body.status;
    try {
      const res = isNew ? await api.post('/items', body) : await api.put(`/items/${item.id}`, body);
      if (isPendingApproval(res)) { notify(APPROVAL_MESSAGE, 'info'); onClose(); return; }
      notify(isNew ? `Item ${res.data.barcode} added` : 'Item saved');
      onSaved(res.data, isNew && printAfter && can('tags.print'));
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
  const grams = { type: 'number', slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } } };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isNew ? 'Add item' : `Edit ${item.item_code}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={4} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <FormSection title="Item details">
              <Grid size={{ xs: 12, sm: 8 }}>{field('name', 'Item name', { required: true, autoFocus: true, placeholder: 'Ladies ring with stone' })}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {field('item_code', 'Item code', isNew ? { placeholder: 'Auto', helperText: 'Blank = same as barcode' } : { required: true, helperText: `Barcode ${item.barcode}` })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('category_id', 'Category', {
                  select: true, required: true,
                  children: categories.filter((c) => c.is_active || c.id === form.category_id).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>),
                })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('karat_id', 'Karat', {
                  select: true, required: true,
                  children: karats.filter((k) => k.is_active || k.id === form.karat_id).map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>),
                })}
              </Grid>
              <Grid size={{ xs: 12 }}>{field('description', 'Description / notes', { multiline: true, minRows: 2 })}</Grid>
            </FormSection>

            <FormSection title="Weight & charges">
              <Grid size={{ xs: 12, sm: 4 }}>{field('net_weight_g', 'Net weight', { required: true, ...grams, helperText: 'Weight of the piece' })}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>{field('wastage_g', 'Wastage', { ...grams, helperText: 'Charged to the customer' })}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {field('making_charge', 'Making charge', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } } })}
              </Grid>
            </FormSection>

            <FormSection title="Stock">
              <Grid size={{ xs: 12, sm: 4 }}>
                {field('stock_qty', 'Quantity in stock', { type: 'number', slotProps: { htmlInput: { min: 0, step: 1 } }, helperText: biscuit ? 'Number of biscuits' : 'Usually 1 for a single piece' })}
              </Grid>
              {canCost && (
                <Grid size={{ xs: 12, sm: 4 }}>
                  {field('cost_price', 'Cost price', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'What the shop paid' })}
                </Grid>
              )}
              {!isNew && (
                <Grid size={{ xs: 12, sm: 4 }}>
                  {field('status', 'Status', {
                    select: true,
                    children: [<MenuItem key="in_stock" value="in_stock">In stock</MenuItem>, <MenuItem key="inactive" value="inactive">Inactive</MenuItem>],
                  })}
                </Grid>
              )}
            </FormSection>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Box sx={{ position: { md: 'sticky' }, top: 0 }}>
              <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '20px', p: 2.5 }}>
                <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Price today</Typography>
                {preview ? (
                  <>
                    {[
                      ['Net weight', formatWeight(form.net_weight_g)],
                      ['+ Wastage', formatWeight(form.wastage_g || 0)],
                      ['= Billed weight', formatWeight(preview.billed_weight_g)],
                      ['× Rate per gram', formatMoney(gramPrice)],
                      ['Gold value', formatMoney(preview.gold_value)],
                      ['+ Making charge', formatMoney(preview.making_charge)],
                    ].map(([label, value]) => (
                      <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4, fontSize: 14 }}>
                        <Typography variant="body2" color="text.secondary">{label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{value}</Typography>
                      </Box>
                    ))}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, pt: 1, borderTop: `1px solid ${gold[200]}` }}>
                      <Typography sx={{ fontWeight: 600 }}>Final price</Typography>
                      <Typography sx={{ fontWeight: 700, color: gold[800] }}>{formatMoney(final)}</Typography>
                    </Box>
                  </>
                ) : (
                  <Typography variant="body2" sx={{ color: stone[600] }}>
                    {form.karat_id && gramPrice === null && prices.length
                      ? 'No gold price entered for this karat yet.'
                      : 'Choose a karat and enter the weight to see the price at today’s rate.'}
                  </Typography>
                )}
              </Box>

              <Box sx={{ border: `1px solid ${stone[200]}`, borderRadius: '20px', p: 2.5, mt: 2 }}>
                <Typography sx={{ fontWeight: 600 }}>Selling price range</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {final === null
                    ? 'Enter how many % above the final price. The prices appear once the weight and gold price are known.'
                    : 'Sold at the max price; discounts can go down to the min price. 0% = the final price. As percentages, the prices follow the gold price automatically.'}
                </Typography>
                <PriceRangeFields
                  final={final}
                  minPercent={form.price_min_percent}
                  maxPercent={form.price_max_percent}
                  onChange={setPercent}
                  errors={errors}
                  cost={cost}
                />
              </Box>
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        {isNew && can('tags.print') && (
          <FormControlLabel sx={{ mr: 'auto', ml: 1 }} label="Print tag after saving"
            control={<Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} />} />
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
