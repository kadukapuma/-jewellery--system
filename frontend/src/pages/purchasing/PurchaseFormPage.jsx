import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Grid, IconButton, InputAdornment, MenuItem, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatMoney } from '../../utils/format';
import { calcItemPrice, formatWeight } from '../../utils/pricing';
import PriceRangeFields, { priceRangeErrors } from '../../components/PriceRangeFields';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import BankAccountPicker from '../../components/BankAccountPicker';
import { needsBankAccount } from '../../utils/bankAccounts';
import { gold, stone } from '../../theme';

let nextKey = 1;
const newLine = () => ({
  key: nextKey++, mode: 'new', name: '', item_code: '', category_id: '', karat_id: '', net_weight_g: '', wastage_g: '',
  making_charge: '', price_min_percent: 0, price_max_percent: 0, qty: 1, purchase_price: '', lookup: '', item: null,
});

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

function lineWeight(l) {
  const unit = l.mode === 'existing' ? Number(l.item?.net_weight_g || 0) : Number(l.net_weight_g || 0);
  return round3(unit * (Number(l.qty) || 0));
}

export default function PurchaseFormPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [karats, setKarats] = useState([]);
  const [head, setHead] = useState({ supplier_id: '', purchase_date: todayYmd(), supplier_invoice_no: '', notes: '' });
  const [lines, setLines] = useState([newLine()]);
  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference_no: '' });
  const [goldPrices, setGoldPrices] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/suppliers'), api.get('/categories'), api.get('/karats')])
      .then(([s, c, k]) => {
        setSuppliers(s.data.filter((x) => x.is_active));
        setCategories(c.data.filter((x) => x.is_active));
        setKarats(k.data.filter((x) => x.is_active));
      })
      .catch((err) => setError(errorMessage(err)));
    if (can('gold_prices.view')) api.get('/gold-prices/current').then((res) => setGoldPrices(res.data.prices)).catch(() => {});
  }, [can]);

  // Final price of one unit of a new line at today's gold rate (null until it can be worked out).
  const lineFinal = (l) => {
    const gram = goldPrices.find((p) => p.karat_id === l.karat_id)?.gram_price ?? null;
    if (gram === null || !(Number(l.net_weight_g) > 0)) return null;
    return calcItemPrice({ net_weight_g: l.net_weight_g, wastage_g: l.wastage_g, making_charge: l.making_charge }, gram).line_total;
  };

  const supplier = suppliers.find((s) => s.id === head.supplier_id);
  const totalWeight = round3(lines.reduce((s, l) => s + lineWeight(l), 0));
  const totalAmount = round2(lines.reduce((s, l) => s + (Number(l.purchase_price) || 0), 0));
  const paidNow = Number(payment.amount) || 0;

  const clearError = (key) => setErrors((e) => ({ ...e, [key]: undefined }));
  const setLine = (index, patch) => {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    Object.keys(patch).forEach((k) => clearError(`lines.${index}.${k}`));
  };

  const findItem = async (index) => {
    const code = lines[index].lookup.trim();
    if (!code) return;
    try {
      const res = await api.get(`/items/lookup/${encodeURIComponent(code)}`);
      setLine(index, { item: res.data });
      clearError(`lines.${index}.item_id`);
    } catch (err) {
      setLine(index, { item: null });
      setErrors((e) => ({ ...e, [`lines.${index}.item_id`]: errorMessage(err) }));
    }
  };

  const validate = () => {
    const e = {};
    if (!head.supplier_id) e.supplier_id = 'Choose a supplier';
    if (!head.purchase_date) e.purchase_date = 'Enter a date';
    lines.forEach((l, i) => {
      if (l.mode === 'existing') {
        if (!l.item) e[`lines.${i}.item_id`] = 'Find the item by barcode or code';
      } else {
        if (!l.name.trim()) e[`lines.${i}.name`] = 'Required';
        if (!l.category_id) e[`lines.${i}.category_id`] = 'Required';
        if (!l.karat_id) e[`lines.${i}.karat_id`] = 'Required';
        if (!(Number(l.net_weight_g) > 0)) e[`lines.${i}.net_weight_g`] = 'Above 0';
        const range = priceRangeErrors(l.price_min_percent, l.price_max_percent);
        Object.entries(range).forEach(([k, v]) => { e[`lines.${i}.${k}`] = v; });
      }
      if (!Number.isInteger(Number(l.qty)) || Number(l.qty) < 1) e[`lines.${i}.qty`] = 'At least 1';
      if (!(Number(l.purchase_price) > 0)) e[`lines.${i}.purchase_price`] = 'Above 0';
    });
    if (payment.amount !== '' && !(paidNow > 0)) e['payment.amount'] = 'Enter an amount above 0, or leave empty';
    if (paidNow > 0 && needsBankAccount(payment.method) && !payment.bank_account_id) e['payment.bank_account_id'] = 'Choose the bank account';
    return e;
  };

  const save = async () => {
    setError('');
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length) {
      setError('Please fix the highlighted fields');
      return;
    }
    setBusy(true);
    const body = {
      ...head,
      lines: lines.map((l) => (l.mode === 'existing'
        ? { item_id: l.item.id, qty: Number(l.qty), purchase_price: Number(l.purchase_price) }
        : {
          name: l.name, item_code: l.item_code, category_id: l.category_id, karat_id: l.karat_id,
          net_weight_g: Number(l.net_weight_g), wastage_g: Number(l.wastage_g) || 0, making_charge: Number(l.making_charge) || 0,
          price_min_percent: l.price_min_percent, price_max_percent: l.price_max_percent,
          qty: Number(l.qty), purchase_price: Number(l.purchase_price),
        })),
      payment: paidNow > 0
        ? { ...payment, amount: paidNow, bank_account_id: needsBankAccount(payment.method) ? payment.bank_account_id : null }
        : null,
    };
    try {
      const res = await api.post('/purchases', body);
      notify(`Purchase ${res.data.purchase_no} saved`);
      navigate(`/purchases/${res.data.id}`, { replace: true, state: { justCreated: true } });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const err = (key) => errors[key];
  const lineField = (i, name, label, props = {}) => (
    <TextField
      label={label}
      value={lines[i][name]}
      onChange={(e) => setLine(i, { [name]: e.target.value })}
      {...props}
      error={!!err(`lines.${i}.${name}`)}
      helperText={err(`lines.${i}.${name}`) || props.helperText}
    />
  );
  const gramsProps = { type: 'number', slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } } };

  return (
    <>
      <PageHeader
        title="New purchase"
        subtitle="Gold items and biscuits bought from a supplier. New items go straight into stock."
        actions={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={() => navigate('/purchases')}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={busy}>Save purchase</Button>
          </Box>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField select label="Supplier" required value={head.supplier_id}
              onChange={(e) => { setHead({ ...head, supplier_id: e.target.value }); clearError('supplier_id'); }}
              error={!!err('supplier_id')}
              helperText={err('supplier_id') || (supplier ? `Owed now ${formatMoney(supplier.balance)} · ${supplier.credit_days ? `${supplier.credit_days} days credit` : 'cash supplier'}` : ' ')}>
              {suppliers.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField label="Date" type="date" required value={head.purchase_date} onChange={(e) => setHead({ ...head, purchase_date: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} error={!!err('purchase_date')} helperText={err('purchase_date') || ' '} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField label="Supplier invoice no." value={head.supplier_invoice_no} onChange={(e) => setHead({ ...head, supplier_invoice_no: e.target.value })} helperText=" " />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField label="Note" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} helperText=" " />
          </Grid>
        </Grid>
      </Card>

      {lines.map((l, i) => {
        const w = lineWeight(l);
        const perGram = w > 0 && Number(l.purchase_price) > 0 ? round2(Number(l.purchase_price) / w) : null;
        return (
          <Card key={l.key} sx={{ p: 2.5, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700 }}>Line {i + 1}</Typography>
              <ToggleButtonGroup size="small" exclusive value={l.mode} onChange={(e, v) => v && setLine(i, { mode: v })}>
                <ToggleButton value="new">New item</ToggleButton>
                <ToggleButton value="existing">More of an existing item</ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ flexGrow: 1 }} />
              {perGram !== null && (
                <Typography variant="body2" color="text.secondary">
                  {formatWeight(w)} · {formatMoney(perGram)} / g
                </Typography>
              )}
              {lines.length > 1 && (
                <Tooltip title="Remove line">
                  <IconButton size="small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>
                </Tooltip>
              )}
            </Box>

            <Grid container spacing={2}>
              {l.mode === 'new' ? (
                <>
                  <Grid size={{ xs: 12, md: 4 }}>{lineField(i, 'name', 'Item name', { required: true, placeholder: 'Gold biscuit 8 g' })}</Grid>
                  <Grid size={{ xs: 6, md: 2 }}>
                    {lineField(i, 'category_id', 'Category', { select: true, required: true, children: categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
                  </Grid>
                  <Grid size={{ xs: 6, md: 2 }}>
                    {lineField(i, 'karat_id', 'Karat', { select: true, required: true, children: karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>) })}
                  </Grid>
                  <Grid size={{ xs: 6, md: 2 }}>{lineField(i, 'net_weight_g', 'Weight each', { required: true, ...gramsProps })}</Grid>
                  <Grid size={{ xs: 6, md: 2 }}>{lineField(i, 'item_code', 'Item code', { placeholder: 'Auto' })}</Grid>
                  <Grid size={{ xs: 6, md: 2 }}>{lineField(i, 'wastage_g', 'Wastage to charge', { ...gramsProps, helperText: 'Usually 0' })}</Grid>
                  <Grid size={{ xs: 6, md: 2 }}>{lineField(i, 'making_charge', 'Making to charge', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } } })}</Grid>
                </>
              ) : (
                <Grid size={{ xs: 12, md: 8 }}>
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <TextField
                      label="Barcode or item code"
                      value={l.lookup}
                      onChange={(e) => setLine(i, { lookup: e.target.value, item: null })}
                      onKeyDown={(e) => e.key === 'Enter' && findItem(i)}
                      onBlur={() => findItem(i)}
                      error={!!err(`lines.${i}.item_id`)}
                      helperText={err(`lines.${i}.item_id`) || 'Scan or type, then Enter'}
                      sx={{ maxWidth: 260 }}
                      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
                    />
                    {l.item && (
                      <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.item.item_code} · {l.item.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {l.item.karat_name} · {formatWeight(l.item.net_weight_g)} each · {l.item.stock_qty} in stock
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Grid>
              )}
              <Grid size={{ xs: 6, md: 2 }}>{lineField(i, 'qty', 'Quantity', { required: true, type: 'number', slotProps: { htmlInput: { min: 1, step: 1 } } })}</Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                {lineField(i, 'purchase_price', 'Price paid (line total)', { required: true, type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } } })}
              </Grid>
              {l.mode === 'new' && (
                <Grid size={{ xs: 12 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr' }, gap: 2, alignItems: 'start', pt: 1, borderTop: `1px dashed ${stone[200]}` }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Selling price (each)</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {lineFinal(l) !== null ? `Final price today ${formatMoney(lineFinal(l))}` : 'Final price shows once karat, weight and gold price are known'}
                      </Typography>
                    </Box>
                    <PriceRangeFields
                      row
                      final={lineFinal(l)}
                      minPercent={l.price_min_percent}
                      maxPercent={l.price_max_percent}
                      onChange={(field, markup) => setLine(i, { [field]: markup })}
                      errors={{ price_min_percent: err(`lines.${i}.price_min_percent`), price_max_percent: err(`lines.${i}.price_max_percent`) }}
                      cost={Number(l.purchase_price) > 0 && Number(l.qty) > 0 ? Number(l.purchase_price) / Number(l.qty) : null}
                    />
                  </Box>
                </Grid>
              )}
            </Grid>
          </Card>
        );
      })}

      <Button startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])} sx={{ mb: 3 }}>Add line</Button>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          {can('supplier_payments.create') && (
            <Card sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 600, mb: 2 }}>Paid now (optional)</Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="Amount" type="number" value={payment.amount}
                    onChange={(e) => { setPayment({ ...payment, amount: e.target.value }); clearError('payment.amount'); }}
                    slotProps={{ htmlInput: { min: 0, step: 'any' } }} error={!!err('payment.amount')}
                    helperText={err('payment.amount') || (totalAmount > 0 ? <Button size="small" sx={{ p: 0, minWidth: 0 }} onClick={() => setPayment({ ...payment, amount: totalAmount })}>Pay full {formatMoney(totalAmount)}</Button> : ' ')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField select label="Paid by" value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} helperText=" ">
                    {Object.entries(PAYMENT_METHODS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="Reference no." value={payment.reference_no} onChange={(e) => setPayment({ ...payment, reference_no: e.target.value })} helperText=" " />
                </Grid>
                {needsBankAccount(payment.method) && (
                  <Grid size={{ xs: 12 }}>
                    <BankAccountPicker label="From account" showBalance value={payment.bank_account_id || ''} error={err('payment.bank_account_id')}
                      onChange={(id) => { setPayment((p) => ({ ...p, bank_account_id: id })); clearError('payment.bank_account_id'); }} />
                  </Grid>
                )}
              </Grid>
            </Card>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ bgcolor: gold[700], color: '#fff', borderRadius: '28px', p: 3 }}>
            {[
              ['Lines', lines.length],
              ['Total gold weight', formatWeight(totalWeight)],
              ['Purchase total', formatMoney(totalAmount)],
              ['Paid now', formatMoney(paidNow)],
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                <Typography sx={{ color: 'rgba(255,255,255,.8)' }}>{label}</Typography>
                <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
              </Box>
            ))}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,.25)' }}>
              <Typography sx={{ fontWeight: 600 }}>{paidNow > totalAmount ? 'Advance' : 'Owed on this purchase'}</Typography>
              <Typography sx={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(Math.abs(round2(totalAmount - paidNow)))}</Typography>
            </Box>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: stone[600] }}>
            Any advance already paid to this supplier is used on this purchase automatically.
          </Typography>
        </Grid>
      </Grid>
    </>
  );
}
