import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Checkbox, Divider, FormControlLabel, IconButton, InputAdornment, MenuItem, Table,
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
import BankAccountPicker from '../../components/BankAccountPicker';
import { needsBankAccount } from '../../utils/bankAccounts';
import { gold, stone } from '../../theme';
import CustomerPicker from './CustomerPicker';
import SalesmanPicker from './SalesmanPicker';
import ItemPickerDialog from './ItemPickerDialog';
import RecyclingIcon from '@mui/icons-material/Recycling';
import { OldGoldExchangeDialog } from '../old-gold/OldGoldDialog';
import { linesBody, priceLine as priceOldGold, totalOf as oldGoldTotal, useOldGoldSetup } from '../old-gold/OldGoldLines';

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
  const [salesman, setSalesman] = useState(null);
  const [discount, setDiscount] = useState('');
  const [useAdvance, setUseAdvance] = useState(true);
  const [oldGold, setOldGold] = useState([]); // pieces taken in exchange (saved with the bill)
  const [editingOldGold, setEditingOldGold] = useState(false);
  const { setup: oldGoldSetup } = useOldGoldSetup();
  const [payments, setPayments] = useState([newPayment()]);
  const [credit, setCredit] = useState({ due_date: '', useInstalments: false, count: 3, frequency: 'monthly', start_date: todayYmd() });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const correcting = location.state?.correcting;

  // "Correct bill": the cancelled bill's items, prices and customer, ready to change and save as a new bill.
  useEffect(() => {
    if (!correcting) return undefined;
    let active = true;
    Promise.all([
      Promise.all(correcting.lines.map((l) => api.get(`/items/${l.item_id}`)
        .then((r) => ({ item: r.data, qty: l.qty, unitPrice: String(l.unit_price) })))),
      correcting.customer_id ? api.get(`/customers/${correcting.customer_id}`).then((r) => r.data) : null,
      correcting.salesman_id ? api.get(`/salesmen/${correcting.salesman_id}`).then((r) => r.data) : null,
    ])
      .then(([items, cust, sm]) => {
        if (active) {
          setCart(items);
          setCustomer(cust);
          if (sm) setSalesman(sm);
        }
      })
      .catch((err) => active && setError(errorMessage(err)));
    return () => { active = false; };
  }, [correcting]);

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
  // Old gold taken in exchange comes off first. A walk-in cannot get more than the bill;
  // a customer's extra stays with the shop as their advance.
  const oldGoldSum = oldGoldTotal(oldGold, oldGoldSetup);
  const oldGoldUsed = round2(Math.min(oldGoldSum.value, total));
  const oldGoldExtra = round2(oldGoldSum.value - oldGoldUsed);
  // Then the customer's advance (money already with the shop), if ticked.
  const advance = customer ? Math.max(0, Number(customer.advance_available) || 0) : 0;
  const advanceUsed = useAdvance ? round2(Math.min(advance, total - oldGoldUsed)) : 0;
  const advanceLeft = round2(advance - advanceUsed);
  const toPay = round2(total - oldGoldUsed - advanceUsed); // final amount the customer pays now
  const change = received > toPay ? round2(received - toPay) : 0;
  const balance = received < toPay ? round2(toPay - received) : 0;
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
  // Typing an amount turns off "Full cash" auto-fill for that row.
  const setPayment = (i, patch) => setPayments((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch, ...('amount' in patch ? { auto: false } : {}) } : p)));

  // A "Full cash" amount follows the amount to pay (advance ticked/unticked, customer, items or discount changed).
  useEffect(() => {
    setPayments((prev) => (prev.length === 1 && prev[0].auto && prev[0].amount !== toPay ? [{ ...prev[0], amount: toPay || '' }] : prev));
  }, [toPay]);

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
    if (oldGoldExtra > 0 && !customer) { setError('The old gold is worth more than the bill. Choose the customer to keep the rest as an advance.'); return; }
    if (payments.some((p) => Number(p.amount) > 0 && needsBankAccount(p.method) && !p.bank_account_id)) {
      setError('Choose the bank account for each card / bank transfer / cheque payment');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/sales', {
        customer_id: customer?.id ?? null,
        salesman_id: salesman?.id ?? null,
        lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty, unit_price: l.price.sold })),
        discount: billDiscount,
        payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({
          method: p.method, reference_no: p.reference_no, amount: Number(p.amount),
          bank_account_id: needsBankAccount(p.method) ? p.bank_account_id : null,
        })),
        due_date: balance > 0 && !credit.useInstalments ? credit.due_date || null : null,
        instalments: balance > 0 && credit.useInstalments ? { count: Number(credit.count), frequency: credit.frequency, start_date: credit.start_date } : null,
        expected_total: total,
        use_advance: advanceUsed > 0,
        old_gold: oldGold.length ? { lines: linesBody(oldGold) } : null,
      });
      notify(`Bill ${res.data.invoice_no} saved${oldGoldUsed > 0 ? ` · old gold ${formatMoney(oldGoldUsed)}` : ''}${advanceUsed > 0 ? ` · advance used ${formatMoney(advanceUsed)}` : ''}${res.data.change ? ` · give change ${formatMoney(res.data.change)}` : ''}`);
      navigate(`/sales/${res.data.id}`, { state: { justCreated: true, change: res.data.change } });
    } catch (err) {
      setError(errorMessage(err));
      if (err.response?.data?.code === 'PRICE_CHANGED') await refreshPrices();
    } finally {
      setBusy(false);
    }
  };

  const canEditPrice = (l) => isAdmin || (canDiscount && l.price.range.min < l.price.range.max);
  const pieces = lines.reduce((s, l) => s + l.qty, 0);
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 };
  const onGold = { color: 'rgba(255,255,255,.8)' };

  return (
    // Desktop: fills the window, nothing scrolls the page. The items list and the side panel scroll inside.
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 400px' },
        gap: 2.5,
        height: { lg: 'calc(100vh - 212px)' }, // header ~96 + bottom padding 32 + footer ~72
        minHeight: { lg: 560 },
      }}
    >
      {/* ---------- Left: scan + items ---------- */}
      <Card sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ p: 2, pb: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
          <Typography sx={{ fontWeight: 600, fontSize: 24, letterSpacing: -0.5, whiteSpace: 'nowrap', mr: 1 }}>New sale</Typography>
          <TextField
            inputRef={scanRef}
            autoFocus
            placeholder="Scan barcode or type item code, then Enter"
            value={scan}
            onChange={(e) => { setScan(e.target.value); setScanError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            error={!!scanError}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><QrCodeScannerIcon /></InputAdornment>,
                endAdornment: <Button size="small" onClick={addItem}>Add</Button>,
                sx: { fontSize: 16, height: 44 },
              },
            }}
          />
          <Button variant="contained" startIcon={<ListIcon />} onClick={() => setPicking(true)} sx={{ height: 44, flexShrink: 0, whiteSpace: 'nowrap' }}>
            Select item
          </Button>
        </Box>
        {(scanError || correcting) && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            {scanError && <Alert severity="error" sx={{ py: 0 }}>{scanError}</Alert>}
            {correcting && (
              <Alert severity="info" sx={{ py: 0, mt: scanError ? 1 : 0 }}>
                Correcting {correcting.invoice_no} (now cancelled). Fix the items, prices or customer, then save the new bill.
              </Alert>
            )}
          </Box>
        )}
        <Divider />

        <TableContainer sx={{ flex: 1, minHeight: { xs: 200, lg: 0 }, overflow: 'auto' }}>
          <Table size="small" stickyHeader sx={{ '& td, & th': { verticalAlign: 'middle' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="center" sx={{ width: 80 }}>Qty</TableCell>
                <TableCell align="right" sx={{ width: 130 }}>Weight</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>Discount</TableCell>
                <TableCell align="right" sx={{ width: 160 }}>Price (each)</TableCell>
                <TableCell align="right" sx={{ width: 130 }}>Total</TableCell>
                <TableCell sx={{ width: 44 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.item.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{l.item.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {l.item.item_code} · {l.item.karat_name} · {formatMoney(l.item.current_gram_price)}/g
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {l.item.stock_qty > 1 ? (
                      <TextField type="number" value={l.qty} onChange={(e) => setQty(l.item.id, Number(e.target.value))}
                        slotProps={{ htmlInput: { min: 1, max: l.item.stock_qty, style: { textAlign: 'center' } } }} sx={{ width: 64 }} />
                    ) : <Typography variant="body2">1</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeight(l.price.billed)}</Typography>
                    {l.price.wastage > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>
                        {l.price.net.toFixed(3)} + {l.price.wastage.toFixed(3)} w
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {canEditPrice(l) ? (
                      <TextField
                        type="number"
                        placeholder="0"
                        value={l.discountText ?? (l.price.valid && l.price.sold < l.price.range.max ? String(round2(l.price.range.max - l.price.sold)) : '')}
                        onChange={(e) => setLineDiscount(l.item.id, e.target.value)}
                        error={l.problem?.level === 'error'}
                        slotProps={{ htmlInput: { min: 0, step: 'any', style: { textAlign: 'right' } } }}
                        sx={{ width: 104 }}
                      />
                    ) : <Typography variant="body2" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    {canEditPrice(l) ? (
                      <TextField
                        type="number"
                        value={l.unitPrice}
                        onChange={(e) => setUnitPrice(l.item.id, e.target.value)}
                        error={l.problem?.level === 'error'}
                        slotProps={{ htmlInput: { step: 'any', style: { textAlign: 'right' } } }}
                        sx={{ width: 144, '& .MuiOutlinedInput-root': l.problem?.level === 'warning' ? { bgcolor: '#FFF4E5' } : {} }}
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
                      <Typography variant="caption" color="success.main" sx={{ display: 'block' }}>− {formatMoney(l.price.max - l.price.total)}</Typography>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox">
                    <Tooltip title="Remove"><IconButton size="small" onClick={() => setCart((p) => p.filter((c) => c.item.id !== l.item.id))}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {!lines.length && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 8, color: 'text.secondary', borderBottom: 0 }}>
                    <QrCodeScannerIcon sx={{ fontSize: 40, color: stone[300], display: 'block', mx: 'auto', mb: 1 }} />
                    Scan an item, or use Select item, to start the bill
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Divider />
        <Box sx={{ ...row, px: 2, py: 1.25, bgcolor: stone[50], flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            {rates.length
              ? `Gold rate: ${rates.map(([k, r]) => `${k} ${formatMoney(r)}/g`).join(' · ')} — fixed on the bill when you save`
              : 'Prices follow today’s gold rate'}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {pieces} {pieces === 1 ? 'piece' : 'pieces'} · {formatMoney(afterLines)}
          </Typography>
        </Box>
      </Card>

      {/* ---------- Right: who, payment, total ---------- */}
      <Card sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Customer & salesman */}
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setUseAdvance(true); }} />
            {customer && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: -0.75 }}>
                {advance > 0 ? `Advance ${formatMoney(advance)} available` : customer.balance > 0 ? `Owes ${formatMoney(customer.balance)}` : 'No balance'}
                {Number(customer.credit_limit) > 0 ? ` · credit limit ${formatMoney(customer.credit_limit)}` : ' · no credit'}
              </Typography>
            )}
            {advance > 0 && (
              <FormControlLabel
                sx={{ mt: -1 }}
                label={<Typography variant="body2">Use advance ({formatMoney(advance)})</Typography>}
                control={<Checkbox size="small" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} />}
              />
            )}
            <SalesmanPicker value={salesman} onChange={setSalesman} />
          </Box>

          {/* Old gold exchange */}
          {can('old_gold.create') && oldGoldSetup && (
            <Box sx={{ border: `1px solid ${stone[200]}`, borderRadius: '14px', px: 1.5, py: 1 }}>
              <Box sx={row}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <RecyclingIcon fontSize="small" sx={{ color: gold[700] }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Old gold</Typography>
                  {oldGold.length > 0 && <Typography variant="body2" color="text.secondary">{formatMoney(oldGoldSum.value)}</Typography>}
                </Box>
                <Box sx={{ display: 'flex', flexShrink: 0 }}>
                  {oldGold.length > 0 && <Button size="small" color="inherit" onClick={() => setOldGold([])}>Remove</Button>}
                  <Button size="small" onClick={() => setEditingOldGold(true)}>{oldGold.length ? 'Change' : 'Add'}</Button>
                </Box>
              </Box>
              {oldGold.map((l, i) => {
                const p = priceOldGold(l, oldGoldSetup);
                return (
                  <Box key={i} sx={row}>
                    <Typography variant="caption" color="text.secondary" noWrap>{l.description} · {p.karatName} · {formatWeight(p.net)}</Typography>
                    <Typography variant="caption">{formatMoney(p.value)}</Typography>
                  </Box>
                );
              })}
              {oldGoldExtra > 0 && (
                <Alert severity={customer ? 'info' : 'warning'} sx={{ mt: 1, py: 0 }}>
                  {customer
                    ? `${formatMoney(oldGoldExtra)} more than the bill stays as ${customer.name}'s advance.`
                    : `Worth ${formatMoney(oldGoldExtra)} more than the bill. Choose the customer to keep it as an advance.`}
                </Alert>
              )}
            </Box>
          )}

          {/* Payment */}
          <Box>
            <Box sx={{ ...row, mb: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>Payment</Typography>
              <Box>
                {payments.length < 4 && (
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setPayments((p) => [...p.map((x) => ({ ...x, auto: false })), newPayment('card')])}>Split</Button>
                )}
                <Button size="small" variant="outlined" onClick={() => setPayments([{ ...newPayment(), amount: toPay, auto: true }])} disabled={!toPay} sx={{ ml: 0.5 }}>Full cash</Button>
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gap: 1 }}>
              {payments.map((p, i) => (
                <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '130px 1fr 32px', gap: 1, alignItems: 'center', ...(p.method !== 'cash' ? { bgcolor: stone[50], borderRadius: '14px', p: 1 } : {}) }}>
                  <TextField select value={p.method} onChange={(e) => setPayment(i, { method: e.target.value })}>
                    {Object.entries(PAYMENT_METHODS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
                  </TextField>
                  <TextField type="number" placeholder="Amount" value={p.amount} onChange={(e) => setPayment(i, { amount: e.target.value })}
                    slotProps={{ htmlInput: { min: 0, step: 'any', style: { textAlign: 'right' } } }} />
                  <IconButton size="small" onClick={() => setPayments((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [newPayment()]))}><DeleteIcon fontSize="small" /></IconButton>
                  {p.method !== 'cash' && (
                    <Box sx={{ gridColumn: '1 / 3', display: 'grid', gap: 1 }}>
                      <BankAccountPicker label="Into account" value={p.bank_account_id || ''} onChange={(id) => setPayment(i, { bank_account_id: id })} />
                      <TextField placeholder={p.method === 'card' ? 'Approval code' : 'Reference no.'} value={p.reference_no}
                        onChange={(e) => setPayment(i, { reference_no: e.target.value })} />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </Box>

          {/* Credit */}
          {balance > 0 && cart.length > 0 && (
            <Box sx={{ p: 1.5, bgcolor: stone[50], borderRadius: '14px' }}>
              <Box sx={row}>
                <Typography sx={{ fontWeight: 600 }}>On credit</Typography>
                <Typography sx={{ fontWeight: 700 }}>{formatMoney(balance)}</Typography>
              </Box>
              {!can('sales.credit') ? (
                <Typography variant="caption" color="error.main">You cannot give credit – take the full amount.</Typography>
              ) : (
                <>
                  {can('instalments.create') && (
                    <FormControlLabel label={<Typography variant="body2">Pay in instalments</Typography>}
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
        </Box>

        {/* Always visible: totals + complete */}
        <Box sx={{ p: 2, pt: 0 }}>
          <Box sx={{ bgcolor: gold[700], color: '#fff', borderRadius: '22px', px: 2.5, py: 2, display: 'grid', gap: 0.5 }}>
            <Box sx={row}>
              <Typography variant="body2" sx={onGold}>Subtotal ({pieces} pcs)</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatMoney(subtotal)}</Typography>
            </Box>
            {discountTotal - billDiscount > 0 && (
              <Box sx={row}>
                <Typography variant="body2" sx={onGold}>Item discounts</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>− {formatMoney(discountTotal - billDiscount)}</Typography>
              </Box>
            )}
            {isAdmin && (
              <Box sx={row}>
                <Typography variant="body2" sx={onGold}>Bill discount (Admin)</Typography>
                <TextField type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0"
                  slotProps={{ htmlInput: { min: 0, step: 'any', style: { textAlign: 'right', padding: '4px 10px' } } }}
                  sx={{ width: 120, '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,.95)' } }} />
              </Box>
            )}
            {oldGoldUsed > 0 && (
              <Box sx={row}>
                <Typography variant="body2" sx={onGold}>Old gold ({formatWeight(oldGoldSum.net)})</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>− {formatMoney(oldGoldUsed)}</Typography>
              </Box>
            )}
            {advanceUsed > 0 && (
              <Box sx={row}>
                <Typography variant="body2" sx={onGold}>Advance{advanceLeft > 0 ? ` (${formatMoney(advanceLeft)} left)` : ''}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>− {formatMoney(advanceUsed)}</Typography>
              </Box>
            )}
            <Divider sx={{ borderColor: 'rgba(255,255,255,.25)', my: 0.75 }} />
            <Box sx={{ ...row, alignItems: 'flex-end' }}>
              <Box>
                <Typography variant="body2" sx={onGold}>{advanceUsed > 0 || oldGoldUsed > 0 ? 'To pay' : 'Total'}</Typography>
                <Typography sx={{ fontSize: 32, fontWeight: 600, letterSpacing: -1, lineHeight: 1.1 }}>{formatMoney(toPay)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ ...onGold, display: 'block' }}>Received {formatMoney(received)}</Typography>
                {change > 0 && <Typography sx={{ fontWeight: 700 }}>Change {formatMoney(change)}</Typography>}
                {balance > 0 && cart.length > 0 && <Typography variant="body2" sx={{ fontWeight: 600 }}>Credit {formatMoney(balance)}</Typography>}
              </Box>
            </Box>
          </Box>
          {error && <Alert severity="error" sx={{ mt: 1.5, py: 0 }}>{error}</Alert>}
          <Button fullWidth size="large" variant="contained" onClick={save} disabled={busy || !cart.length || hasPriceError} sx={{ mt: 1.5, height: 50 }}>
            Complete sale {toPay ? formatMoney(toPay) : ''}
          </Button>
        </Box>
      </Card>

      {editingOldGold && (
        <OldGoldExchangeDialog initial={oldGold} setup={oldGoldSetup} onClose={() => setEditingOldGold(false)}
          onDone={(next) => { setOldGold(next); setEditingOldGold(false); }} />
      )}
      {picking && (
        <ItemPickerDialog inCart={new Set(cart.map((c) => c.item.id))} onClose={() => setPicking(false)} onAdd={addPicked} />
      )}
    </Box>
  );
}
