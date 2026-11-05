import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Checkbox, Divider, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import ListIcon from '@mui/icons-material/ManageSearch';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { calcItemPrice, calcPriceRange, formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import { gold, stone } from '../../theme';
import CustomerPicker from './CustomerPicker';
import ItemPickerDialog from './ItemPickerDialog';

const round2 = (n) => Math.round(n * 100) / 100;

// unitPrice: the price typed for one unit ('' or invalid = the max price).
function priceLine(item, qty, unitPrice) {
  const unit = calcItemPrice(item, item.current_gram_price);
  const range = calcPriceRange(item, item.current_gram_price);
  const typed = Number(unitPrice);
  const valid = unitPrice !== '' && Number.isFinite(typed) && typed > 0;
  const sold = valid ? typed : range.max;
  return {
    net: Math.round(item.net_weight_g * qty * 1000) / 1000,
    wastage: Math.round(item.wastage_g * qty * 1000) / 1000,
    billed: Math.round(unit.billed_weight_g * qty * 1000) / 1000,
    range,
    valid,
    sold,
    max: round2(range.max * qty),
    total: round2(sold * qty),
  };
}

// Discount permission may go down to the min price; only an Admin below it. Nobody above the max.
function priceProblem(p, canDiscount, isAdmin) {
  if (!p.valid) return { level: 'error', text: 'Enter a price' };
  if (p.sold > p.range.max + 0.009) return { level: 'error', text: `Max is ${formatMoney(p.range.max)}` };
  if (p.sold < p.range.max - 0.009 && !canDiscount) return { level: 'error', text: 'You cannot give discounts' };
  if (p.sold < p.range.min - 0.009) {
    if (!isAdmin) return { level: 'error', text: `Lowest is ${formatMoney(p.range.min)}` };
    return { level: 'warning', text: p.sold < p.range.final ? 'Below the final price!' : 'Below the min price (Admin)' };
  }
  return null;
}

const newPayment = (method = 'cash') => ({ method, amount: '', reference_no: '' });

// The sales counter: scan items, price them at the gold rate right now, take payment.
export default function PosPage() {
  const { can, user } = useAuth();
  const isAdmin = user.is_super_admin;
  const canDiscount = can('sales.discount');
  const notify = useNotify();
  const navigate = useNavigate();
  const scanRef = useRef(null);
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState('');
  const [picking, setPicking] = useState(false);
  const [cart, setCart] = useState([]); // { item, qty, unitPrice }
  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState([newPayment()]);
  const [credit, setCredit] = useState({ due_date: '', useInstalments: false, count: 3, frequency: 'monthly', start_date: todayYmd() });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = cart.map((c) => {
    const price = priceLine(c.item, c.qty, c.unitPrice);
    return { ...c, price, problem: priceProblem(price, canDiscount, isAdmin) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.price.max, 0)); // at max prices
  const afterLines = round2(lines.reduce((s, l) => s + l.price.total, 0));
  const billDiscount = isAdmin ? Math.min(Number(discount) || 0, afterLines) : 0;
  const total = round2(afterLines - billDiscount);
  const discountTotal = round2(subtotal - total);
  const hasPriceError = lines.some((l) => l.problem?.level === 'error');
  const received = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const change = received > total ? round2(received - total) : 0;
  const balance = received < total ? round2(total - received) : 0;
  const rates = [...new Map(lines.map((l) => [l.item.karat_name, l.item.current_gram_price])).entries()];

  const addItem = async () => {
    const code = scan.trim();
    if (!code) return;
    setScanError('');
    try {
      const res = await api.get(`/items/lookup/${encodeURIComponent(code)}`);
      const item = res.data;
      if (item.status !== 'in_stock' || item.stock_qty < 1) throw new Error(`${item.item_code} is ${item.status === 'sold' ? 'already sold' : 'not in stock'}`);
      if (item.current_gram_price === null) throw new Error(`No gold price for ${item.karat_name} yet. Update gold prices first.`);
      setCart((prev) => {
        const existing = prev.find((c) => c.item.id === item.id);
        if (existing) {
          if (existing.qty >= item.stock_qty) {
            setScanError(`Only ${item.stock_qty} of ${item.item_code} in stock`);
            return prev;
          }
          return prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
        }
        return [...prev, { item, qty: 1, unitPrice: String(item.price_max_now) }];
      });
      setScan('');
    } catch (err) {
      setScanError(err.response ? errorMessage(err) : err.message);
    }
    scanRef.current?.focus();
  };

  // Items chosen in the "Select item" window (already checked as in stock and priced).
  const addPicked = (items) => {
    setCart((prev) => [
      ...prev,
      ...items.filter((i) => !prev.some((c) => c.item.id === i.id)).map((item) => ({ item, qty: 1, unitPrice: String(item.price_max_now) })),
    ]);
    setPicking(false);
    setScanError('');
    scanRef.current?.focus();
  };

  const setUnitPrice = (id, unitPrice) => setCart((prev) => prev.map((c) => (c.item.id === id ? { ...c, unitPrice, discountText: undefined } : c)));
  // Discount off one unit's max price; the price follows it. discountText keeps what was typed (e.g. '' or '1.').
  const setLineDiscount = (id, discountText) => setCart((prev) => prev.map((c) => {
    if (c.item.id !== id) return c;
    const max = calcPriceRange(c.item, c.item.current_gram_price).max;
    return { ...c, discountText, unitPrice: String(round2(max - (Number(discountText) || 0))) };
  }));
  const setQty = (id, qty) => setCart((prev) => prev.map((c) => (c.item.id === id ? { ...c, qty: Math.max(1, Math.min(c.item.stock_qty, qty || 1)) } : c)));
  const setPayment = (i, patch) => setPayments((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  // Re-read prices if the gold price changed while billing; prices go back to the new max.
  const refreshPrices = async () => {
    const fresh = await Promise.all(cart.map((c) => api.get(`/items/${c.item.id}`)
      .then((r) => ({ ...c, item: r.data, unitPrice: String(r.data.price_max_now), discountText: undefined }))));
    setCart(fresh);
  };

  const save = async () => {
    setError('');
    if (!cart.length) { setError('Scan at least one item'); return; }
    if (hasPriceError) { setError('Fix the prices marked in red'); return; }
    if (balance > 0 && !customer) { setError('The bill is not fully paid. Choose a customer to give credit, or take the full amount.'); return; }
    setBusy(true);
    try {
      const res = await api.post('/sales', {
        customer_id: customer?.id ?? null,
        lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty, unit_price: l.price.sold })),
        discount: billDiscount,
        payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, amount: Number(p.amount) })),
        due_date: balance > 0 && !credit.useInstalments ? credit.due_date || null : null,
        instalments: balance > 0 && credit.useInstalments ? { count: Number(credit.count), frequency: credit.frequency, start_date: credit.start_date } : null,
        expected_total: total,
      });
      notify(`Bill ${res.data.invoice_no} saved${res.data.change ? ` · give change ${formatMoney(res.data.change)}` : ''}`);
      navigate(`/sales/${res.data.id}`, { state: { justCreated: true, change: res.data.change } });
    } catch (err) {
      setError(errorMessage(err));
      if (err.response?.data?.code === 'PRICE_CHANGED') await refreshPrices();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Typography sx={{ fontWeight: 600, fontSize: { xs: 30, md: 40 }, letterSpacing: -1.5, mb: 2 }}>New sale</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <TextField
            inputRef={scanRef}
            autoFocus
            placeholder="Scan barcode or type item code, then Enter"
            value={scan}
            onChange={(e) => { setScan(e.target.value); setScanError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            error={!!scanError}
            helperText={scanError || ' '}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><QrCodeScannerIcon /></InputAdornment>,
                endAdornment: <Button size="small" onClick={addItem}>Add</Button>,
                sx: { fontSize: 18, py: 0.5 },
              },
            }}
          />
          <Button variant="contained" startIcon={<ListIcon />} onClick={() => setPicking(true)} sx={{ height: 48, flexShrink: 0 }}>
            Select item
          </Button>
        </Box>
        <Card sx={{ mt: 1 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="center">Qty</TableCell>
                  <TableCell align="right">Billed weight</TableCell>
                  <TableCell align="right">Discount (each)</TableCell>
                  <TableCell align="right">Price (each)</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.item.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.item.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{l.item.item_code}</Typography>
                      <Typography variant="caption" color="text.secondary">{l.item.karat_name} · {formatMoney(l.item.current_gram_price)} / g</Typography>
                    </TableCell>
                    <TableCell align="center">
                      {l.item.stock_qty > 1 ? (
                        <TextField type="number" value={l.qty} onChange={(e) => setQty(l.item.id, Number(e.target.value))}
                          slotProps={{ htmlInput: { min: 1, max: l.item.stock_qty, style: { textAlign: 'center' } } }} sx={{ width: 70 }} />
                      ) : 1}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeight(l.price.billed)}</Typography>
                      {l.price.wastage > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {l.price.net.toFixed(3)} net + {l.price.wastage.toFixed(3)} wastage
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      {isAdmin || (canDiscount && l.price.range.min < l.price.range.max) ? (
                        <TextField
                          type="number"
                          placeholder="0"
                          value={l.discountText ?? (l.price.valid && l.price.sold < l.price.range.max ? String(round2(l.price.range.max - l.price.sold)) : '')}
                          onChange={(e) => setLineDiscount(l.item.id, e.target.value)}
                          error={l.problem?.level === 'error'}
                          slotProps={{ htmlInput: { min: 0, step: 'any', style: { textAlign: 'right' } } }}
                          sx={{ width: 110 }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 170 }}>
                      {isAdmin || (canDiscount && l.price.range.min < l.price.range.max) ? (
                        <TextField
                          type="number"
                          value={l.unitPrice}
                          onChange={(e) => setUnitPrice(l.item.id, e.target.value)}
                          error={l.problem?.level === 'error'}
                          slotProps={{ htmlInput: { step: 'any', style: { textAlign: 'right' } } }}
                          sx={{ width: 150, '& .MuiOutlinedInput-root': l.problem?.level === 'warning' ? { bgcolor: '#FFF4E5' } : {} }}
                        />
                      ) : (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatMoney(l.price.range.max)}</Typography>
                      )}
                      <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'nowrap', color: l.problem ? `${l.problem.level}.main` : 'text.secondary' }}>
                        {l.problem ? l.problem.text : l.price.range.min < l.price.range.max
                          ? `${formatMoney(l.price.range.min)} – ${formatMoney(l.price.range.max)}`
                          : 'Fixed price'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatMoney(l.price.total)}</Typography>
                      {l.price.total < l.price.max && (
                        <Typography variant="caption" color="success.main">− {formatMoney(l.price.max - l.price.total)}</Typography>
                      )}
                    </TableCell>
                    <TableCell padding="checkbox">
                      <Tooltip title="Remove"><IconButton size="small" onClick={() => setCart((p) => p.filter((c) => c.item.id !== l.item.id))}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!lines.length && (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>Scan an item to start the bill</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
        {rates.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Gold rate used: {rates.map(([k, r]) => `${k} ${formatMoney(r)}/g`).join(' · ')} — the price is fixed on the bill when you save.
          </Typography>
        )}
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Box sx={{ position: { lg: 'sticky' }, top: 16 }}>
          <Card sx={{ p: 2.5, mb: 2 }}>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {customer && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {customer.balance > 0 ? `Owes ${formatMoney(customer.balance)}` : customer.balance < 0 ? `Advance ${formatMoney(-customer.balance)} – used on this bill` : 'No balance'}
                {Number(customer.credit_limit) > 0 ? ` · credit limit ${formatMoney(customer.credit_limit)}` : ' · no credit'}
              </Typography>
            )}
          </Card>

          <Box sx={{ bgcolor: gold[700], color: '#fff', borderRadius: '28px', p: 3, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ color: 'rgba(255,255,255,.8)' }}>Subtotal ({lines.reduce((s, l) => s + l.qty, 0)} pcs)</Typography>
              <Typography sx={{ fontWeight: 600 }}>{formatMoney(subtotal)}</Typography>
            </Box>
            {discountTotal - billDiscount > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ color: 'rgba(255,255,255,.8)' }}>Item discounts</Typography>
                <Typography sx={{ fontWeight: 600 }}>− {formatMoney(discountTotal - billDiscount)}</Typography>
              </Box>
            )}
            {isAdmin && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography sx={{ color: 'rgba(255,255,255,.8)' }}>Bill discount (Admin)</Typography>
                <TextField type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0"
                  slotProps={{ htmlInput: { min: 0, step: 'any', style: { textAlign: 'right' } } }}
                  sx={{ width: 140, '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,.95)' } }} />
              </Box>
            )}
            <Divider sx={{ borderColor: 'rgba(255,255,255,.25)', my: 1.5 }} />
            <Typography sx={{ color: 'rgba(255,255,255,.8)' }}>Total</Typography>
            <Typography sx={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.1 }}>{formatMoney(total)}</Typography>
          </Box>

          <Card sx={{ p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
              <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>Payment</Typography>
              <Button size="small" onClick={() => setPayments([{ ...newPayment(), amount: total }])} disabled={!total}>Full cash</Button>
            </Box>
            {payments.map((p, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1, mb: 1 }}>
                <TextField select value={p.method} onChange={(e) => setPayment(i, { method: e.target.value })}>
                  {Object.entries(PAYMENT_METHODS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
                </TextField>
                <TextField type="number" placeholder="Amount" value={p.amount} onChange={(e) => setPayment(i, { amount: e.target.value })}
                  slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
                <IconButton size="small" onClick={() => setPayments((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [newPayment()]))}><DeleteIcon fontSize="small" /></IconButton>
                {p.method !== 'cash' && (
                  <TextField placeholder={p.method === 'card' ? 'Approval code' : 'Reference no.'} value={p.reference_no}
                    onChange={(e) => setPayment(i, { reference_no: e.target.value })} sx={{ gridColumn: '1 / 3' }} />
                )}
              </Box>
            ))}
            {payments.length < 4 && (
              <Button size="small" startIcon={<AddIcon />} onClick={() => setPayments((p) => [...p, newPayment('card')])}>Split payment</Button>
            )}
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography color="text.secondary">Received</Typography>
              <Typography sx={{ fontWeight: 600 }}>{formatMoney(received)}</Typography>
            </Box>
            {change > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography sx={{ fontWeight: 600, color: 'success.main' }}>Change to give</Typography>
                <Typography sx={{ fontWeight: 700, color: 'success.main', fontSize: 20 }}>{formatMoney(change)}</Typography>
              </Box>
            )}
            {balance > 0 && cart.length > 0 && (
              <Box sx={{ mt: 1, p: 1.5, bgcolor: stone[50], borderRadius: '14px' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontWeight: 600 }}>On credit</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{formatMoney(balance)}</Typography>
                </Box>
                {!can('sales.credit') ? (
                  <Typography variant="caption" color="error.main">You cannot give credit – take the full amount.</Typography>
                ) : (
                  <>
                    {can('instalments.create') && (
                      <FormControlLabel label="Pay in instalments"
                        control={<Checkbox size="small" checked={credit.useInstalments} onChange={(e) => setCredit({ ...credit, useInstalments: e.target.checked })} />} />
                    )}
                    {credit.useInstalments ? (
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <TextField label="Instalments" type="number" value={credit.count} onChange={(e) => setCredit({ ...credit, count: e.target.value })}
                          slotProps={{ htmlInput: { min: 2, max: 60 } }} />
                        <TextField select label="Every" value={credit.frequency} onChange={(e) => setCredit({ ...credit, frequency: e.target.value })}>
                          <MenuItem value="monthly">Month</MenuItem>
                          <MenuItem value="weekly">Week</MenuItem>
                        </TextField>
                        <TextField label="First due" type="date" value={credit.start_date} onChange={(e) => setCredit({ ...credit, start_date: e.target.value })}
                          slotProps={{ inputLabel: { shrink: true } }} sx={{ gridColumn: '1 / 3' }}
                          helperText={Number(credit.count) >= 2 ? `${credit.count} × about ${formatMoney(balance / Number(credit.count))}` : ' '} />
                      </Box>
                    ) : (
                      <TextField label="Pay by" type="date" value={credit.due_date} onChange={(e) => setCredit({ ...credit, due_date: e.target.value })}
                        slotProps={{ inputLabel: { shrink: true } }} sx={{ mt: 1 }} />
                    )}
                  </>
                )}
              </Box>
            )}
          </Card>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Button fullWidth size="large" variant="contained" onClick={save} disabled={busy || !cart.length || hasPriceError}>
            Complete sale {total ? formatMoney(total) : ''}
          </Button>
        </Box>
      </Grid>
      {picking && (
        <ItemPickerDialog inCart={new Set(cart.map((c) => c.item.id))} onClose={() => setPicking(false)} onAdd={addPicked} />
      )}
    </Grid>
  );
}
