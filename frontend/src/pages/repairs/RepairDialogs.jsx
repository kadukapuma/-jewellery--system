import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, MenuItem, Switch,
  Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS, todayYmd } from '../../utils/payments';
import { gold, stone } from '../../theme';
import CustomerPicker from '../sales/CustomerPicker';
import { heldOfKarat } from '../workshop/heldGold';

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const grams = { type: 'number', slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } } };
const amount = { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } } };
const dateProps = { type: 'date', slotProps: { inputLabel: { shrink: true } } };

// Form state + field helper shared by every dialog here.
function useForm(initial) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (name) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((x) => ({ ...x, [name]: undefined }));
  };
  const field = (name, label, props = {}) => (
    <TextField label={label} value={form[name]} onChange={set(name)} {...props} error={!!errors[name]} helperText={errors[name] || props.helperText} />
  );
  // Runs the request; shows server errors on the fields / at the top.
  const submit = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { form, setForm, errors, setErrors, error, busy, set, field, submit };
}

function PaymentFields({ f, prefix = '' }) {
  const n = (k) => `${prefix}${k}`;
  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        {f.field(n('method'), 'Paid by', { select: true, children: Object.entries(PAYMENT_METHODS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>) })}
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>{f.field(n('reference_no'), f.form[n('method')] === 'cheque' ? 'Cheque no.' : 'Reference no.')}</Grid>
      {f.form[n('method')] === 'cheque' && <Grid size={{ xs: 12, sm: 6 }}>{f.field(n('cheque_date'), 'Cheque date', dateProps)}</Grid>}
    </>
  );
}

const paymentBody = (form, value, prefix = '') => (value > 0 ? {
  amount: value,
  method: form[`${prefix}method`],
  reference_no: form[`${prefix}reference_no`],
  cheque_date: form[`${prefix}method`] === 'cheque' ? form[`${prefix}cheque_date`] || null : null,
} : null);

function SummaryBox({ rows, children }) {
  return (
    <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '20px', p: 2.5 }}>
      {rows.map(([label, value, color]) => (
        <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4, gap: 2 }}>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, color, textAlign: 'right' }}>{value}</Typography>
        </Box>
      ))}
      {children}
    </Box>
  );
}

// "+0.050 g heavier" / "0.050 g short" / "Same"
export function weightDiff(actual, expected) {
  const d = round3(actual - expected);
  if (Math.abs(d) < 0.0005) return { text: 'Same weight', color: 'success.main' };
  return { text: `${formatWeight(Math.abs(d))} ${d > 0 ? 'heavier' : 'short'}`, color: 'error.main' };
}

// 1. The customer hands the item in.
export function ReceiveRepairDialog({ onClose, onSaved }) {
  const notify = useNotify();
  const [customer, setCustomer] = useState(null);
  const [karats, setKarats] = useState([]);
  const f = useForm({
    received_date: todayYmd(), item_description: '', karat_id: '', weight_in_g: '', work_to_do: '', promised_date: '',
    estimated_charge: '', notes: '', advance: '', method: 'cash', reference_no: '', cheque_date: '',
  });
  useEffect(() => { api.get('/karats').then((r) => setKarats(r.data.filter((k) => k.is_active))).catch(() => {}); }, []);
  const advance = Number(f.form.advance) || 0;

  const save = () => {
    const e = {};
    if (!customer) e.customer = 'Choose the customer';
    if (!f.form.item_description.trim()) e.item_description = 'Describe the item';
    if (!(Number(f.form.weight_in_g) > 0)) e.weight_in_g = 'Weigh the item';
    if (advance < 0) e.advance = 'Cannot be negative';
    f.setErrors(e);
    if (Object.keys(e).length) return;
    f.submit(async () => {
      const res = await api.post('/repairs', {
        ...f.form,
        customer_id: customer.id,
        karat_id: f.form.karat_id || null,
        weight_in_g: Number(f.form.weight_in_g),
        promised_date: f.form.promised_date || null,
        estimated_charge: Number(f.form.estimated_charge) || 0,
        advance: paymentBody(f.form, advance),
      });
      notify(`${res.data.repair_no} taken in for ${res.data.customer_name}`);
      onSaved(res.data);
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Take in an item for repair</DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 7 }}>
            <FormSection title="Customer">
              <Grid size={{ xs: 12 }}>
                <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); f.setErrors((x) => ({ ...x, customer: undefined })); }} />
                {f.errors.customer && <Typography variant="caption" color="error">{f.errors.customer}</Typography>}
              </Grid>
            </FormSection>
            <FormSection title="Item">
              <Grid size={{ xs: 12 }}>{f.field('item_description', 'Item', { required: true, placeholder: 'Ladies ring with red stone' })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('weight_in_g', 'Weight now', { required: true, ...grams, helperText: 'Weigh it in front of the customer' })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {f.field('karat_id', 'Karat', { select: true, helperText: 'If known', children: [<MenuItem key="" value="">Not known</MenuItem>, ...karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>)] })}
              </Grid>
              <Grid size={{ xs: 12 }}>{f.field('work_to_do', 'Work to do', { placeholder: 'Resize to 7, fix the clasp, polish' })}</Grid>
            </FormSection>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <FormSection title="Dates & charge">
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('received_date', 'Date received', dateProps)}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('promised_date', 'Ready by', dateProps)}</Grid>
              <Grid size={{ xs: 12 }}>{f.field('estimated_charge', 'Estimated charge', { ...amount, helperText: 'Told to the customer' })}</Grid>
            </FormSection>
            <FormSection title="Advance (optional)">
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('advance', 'Advance paid', amount)}</Grid>
              {advance > 0 && <PaymentFields f={f} />}
            </FormSection>
            <Grid size={{ xs: 12 }}>{f.field('notes', 'Note', { multiline: true, minRows: 2 })}</Grid>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={f.busy}>Save & print slip</Button>
      </DialogActions>
    </Dialog>
  );
}

// 2. Give it to a craftsman, with any shop gold to add.
export function GiveRepairDialog({ repair, onClose, onSaved }) {
  const notify = useNotify();
  const [craftsmen, setCraftsmen] = useState([]);
  const [karats, setKarats] = useState([]);
  const [useHeld, setUseHeld] = useState(true);
  const f = useForm({ craftsman_id: '', given_date: todayYmd(), craftsman_fee: '', karat_id: repair.karat_id || '', extra_gold_g: '' });
  useEffect(() => {
    Promise.all([api.get('/craftsmen'), api.get('/karats')])
      .then(([c, k]) => { setCraftsmen(c.data.filter((x) => x.is_active)); setKarats(k.data.filter((x) => x.is_active)); })
      .catch(() => {});
  }, []);

  const extra = Number(f.form.extra_gold_g) || 0;
  const craftsman = craftsmen.find((c) => c.id === f.form.craftsman_id);
  const karatName = karats.find((k) => k.id === f.form.karat_id)?.name || '';
  const holds = f.form.karat_id ? Math.max(0, heldOfKarat(craftsman, f.form.karat_id)) : 0;
  const heldUsed = useHeld ? round3(Math.min(holds, extra)) : 0;

  const save = () => {
    const e = {};
    if (!f.form.craftsman_id) e.craftsman_id = 'Choose a craftsman';
    if (extra < 0) e.extra_gold_g = 'Cannot be negative';
    if (extra > 0 && !f.form.karat_id) e.karat_id = 'Choose the karat of the gold added';
    f.setErrors(e);
    if (Object.keys(e).length) return;
    f.submit(async () => {
      const res = await api.post(`/repairs/${repair.id}/give`, {
        ...f.form, karat_id: f.form.karat_id || null, extra_gold_g: extra, craftsman_fee: Number(f.form.craftsman_fee) || 0, use_held_gold: useHeld,
      });
      notify(`${repair.repair_no} given to ${res.data.craftsman_name}`);
      onSaved(res.data);
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Give {repair.repair_no} to a craftsman
        <Typography variant="body2" color="text.secondary">{repair.item_description} · {formatWeight(repair.weight_in_g)} · {repair.customer_name}</Typography>
      </DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        {repair.work_to_do && <Alert severity="info" sx={{ mb: 2 }}>Work to do: {repair.work_to_do}</Alert>}
        <FormSection title="Craftsman">
          <Grid size={{ xs: 12, sm: 6 }}>
            {f.field('craftsman_id', 'Craftsman', { select: true, required: true, autoFocus: true, children: craftsmen.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{f.field('given_date', 'Date given', dateProps)}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{f.field('craftsman_fee', 'Craftsman fee', { ...amount, helperText: 'What you pay him (can change when it is back)' })}</Grid>
        </FormSection>
        <FormSection title="Shop gold added (if any)">
          <Grid size={{ xs: 12, sm: 6 }}>{f.field('extra_gold_g', 'Extra gold', { ...grams, placeholder: '0', helperText: 'The customer pays for it' })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {f.field('karat_id', 'Karat', { select: true, required: extra > 0, children: karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>) })}
          </Grid>
          {extra > 0 && holds > 0 && (
            <Grid size={{ xs: 12 }}>
              <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1.2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{craftsman.name} already holds {formatWeight(holds)} of {karatName}</Typography>
                  <FormControlLabel sx={{ mr: 0 }} label={<Typography variant="body2">Use the gold he already has</Typography>}
                    control={<Switch size="small" checked={useHeld} onChange={(e) => setUseHeld(e.target.checked)} />} />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {useHeld
                    ? heldUsed >= extra ? `All ${formatWeight(extra)} comes from his gold · no new gold to give` : `${formatWeight(heldUsed)} from his gold · give ${formatWeight(round3(extra - heldUsed))} of new gold`
                    : `Not used · give all ${formatWeight(extra)} as new gold`}
                </Typography>
              </Box>
            </Grid>
          )}
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={f.busy}>Give to craftsman</Button>
      </DialogActions>
    </Dialog>
  );
}

// 3. Back from the craftsman: weigh it against what went out.
export function RepairBackDialog({ repair, onClose, onSaved }) {
  const notify = useNotify();
  const f = useForm({ back_date: todayYmd(), weight_back_g: '', craftsman_fee: repair.craftsman_fee ?? 0 });
  const extra = Number(repair.extra_gold_g) || 0;
  const expected = round3(Number(repair.weight_in_g) + extra);
  const back = Number(f.form.weight_back_g) || 0;
  const diff = back > 0 ? weightDiff(back, expected) : null;
  const short = back > 0 ? Math.max(0, round3(expected - back)) : 0;

  const save = () => {
    if (!(back > 0)) { f.setErrors({ weight_back_g: 'Weigh the item' }); return; }
    f.submit(async () => {
      await api.post(`/repairs/${repair.id}/back`, { ...f.form, weight_back_g: back, craftsman_fee: Number(f.form.craftsman_fee) || 0 });
      notify(`${repair.repair_no} is back and ready for ${repair.customer_name}`);
      onSaved();
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {repair.repair_no} back from {repair.craftsman_name}
        <Typography variant="body2" color="text.secondary">{repair.item_description} · {repair.customer_name}</Typography>
      </DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        <Grid container spacing={3} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>{f.field('weight_back_g', 'Weight now', { required: true, autoFocus: true, ...grams })}</Grid>
              <Grid size={{ xs: 12 }}>{f.field('back_date', 'Date back', dateProps)}</Grid>
              <Grid size={{ xs: 12 }}>{f.field('craftsman_fee', 'Craftsman fee', { ...amount, helperText: 'Added to what you owe him' })}</Grid>
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <SummaryBox rows={[
              ['Weight in', formatWeight(repair.weight_in_g)],
              ...(extra > 0 ? [['Shop gold added', formatWeight(extra)]] : []),
              ['Expected', formatWeight(expected)],
              ['Weight now', back > 0 ? formatWeight(back) : '—'],
              ...(diff ? [['Difference', diff.text, diff.color]] : []),
            ]}>
              {short > extra && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  {formatWeight(round3(short - extra))} of the customer’s own gold is missing. Check with {repair.craftsman_name}.
                </Alert>
              )}
            </SummaryBox>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={f.busy}>Mark ready</Button>
      </DialogActions>
    </Dialog>
  );
}

// 4. The customer collects it: weigh it in front of them, set the charge, take the money.
export function DeliverRepairDialog({ repair, onClose, onSaved }) {
  const { can } = useAuth();
  const notify = useNotify();
  const extra = Number(repair.extra_gold_g) || 0;
  const [gramPrice, setGramPrice] = useState(null);
  const f = useForm({
    delivered_date: todayYmd(), weight_out_g: repair.weight_back_g ?? '', repair_charge: repair.estimated_charge || '', gold_charge: '',
    pay: '', method: 'cash', reference_no: '', cheque_date: '',
  });

  // Shop gold added is charged at today's rate (can be changed).
  useEffect(() => {
    if (!(extra > 0) || !repair.karat_id || !can('gold_prices.view')) return;
    api.get('/gold-prices/current').then((res) => {
      const price = res.data.prices.find((p) => p.karat_id === repair.karat_id)?.gram_price;
      if (price) {
        setGramPrice(Number(price));
        f.setForm((x) => (x.gold_charge === '' ? { ...x, gold_charge: String(round2(extra * Number(price))) } : x));
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra, repair.karat_id, can]);

  const total = round2((Number(f.form.repair_charge) || 0) + (Number(f.form.gold_charge) || 0));
  const due = round2(total - repair.paid_amount);
  const pay = Number(f.form.pay) || 0;
  const out = Number(f.form.weight_out_g) || 0;
  const diff = out > 0 ? weightDiff(out, Number(repair.weight_back_g)) : null;

  // Fill "paying now" with what is due the first time the charge is known.
  useEffect(() => {
    f.setForm((x) => (x.pay === '' && due > 0 ? { ...x, pay: String(due) } : x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const e = {};
    if (!(out > 0)) e.weight_out_g = 'Weigh the item';
    if (pay < 0) e.pay = 'Cannot be negative';
    else if (pay > Math.max(0, due) + 0.005) e.pay = `Only ${formatMoney(Math.max(0, due))} is due`;
    f.setErrors(e);
    if (Object.keys(e).length) return;
    f.submit(async () => {
      await api.post(`/repairs/${repair.id}/deliver`, {
        delivered_date: f.form.delivered_date,
        weight_out_g: out,
        repair_charge: Number(f.form.repair_charge) || 0,
        gold_charge: Number(f.form.gold_charge) || 0,
        payment: paymentBody(f.form, pay),
      });
      const left = round2(due - pay);
      notify(`${repair.repair_no} handed to ${repair.customer_name}${left > 0 ? ` · ${formatMoney(left)} on credit` : ''}`);
      onSaved();
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Hand over {repair.repair_no}
        <Typography variant="body2" color="text.secondary">{repair.item_description} · {repair.customer_name}{repair.customer_phone ? ` · ${repair.customer_phone}` : ''}</Typography>
      </DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 7 }}>
            <FormSection title="Item">
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('weight_out_g', 'Weight now', { required: true, ...grams, helperText: 'Weigh it in front of the customer' })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('delivered_date', 'Date collected', dateProps)}</Grid>
            </FormSection>
            <FormSection title="Charge">
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('repair_charge', 'Repair charge', { ...amount, helperText: `Estimated ${formatMoney(repair.estimated_charge)}` })}</Grid>
              {extra > 0 && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  {f.field('gold_charge', `Gold added (${formatWeight(extra)})`, { ...amount, helperText: gramPrice ? `${formatWeight(extra)} × ${formatMoney(gramPrice)} today` : 'Shop gold put in the piece' })}
                </Grid>
              )}
            </FormSection>
            <FormSection title="Payment">
              <Grid size={{ xs: 12, sm: 6 }}>{f.field('pay', 'Paying now', { ...amount, helperText: due > 0 ? `${formatMoney(due)} due` : 'Nothing due' })}</Grid>
              {pay > 0 && <PaymentFields f={f} />}
            </FormSection>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <SummaryBox rows={[
              ['Weight in', formatWeight(repair.weight_in_g)],
              ...(extra > 0 ? [['Shop gold added', formatWeight(extra)]] : []),
              ['Back from craftsman', formatWeight(repair.weight_back_g)],
              ['Weight now', out > 0 ? formatWeight(out) : '—'],
              ...(diff ? [['Since it came back', diff.text, diff.color]] : []),
            ]} />
            <Box sx={{ border: `1px solid ${stone[200]}`, borderRadius: '20px', p: 2.5, mt: 2 }}>
              {[
                ['Total charge', formatMoney(total)],
                ...(repair.paid_amount > 0 ? [['Advance paid', `− ${formatMoney(repair.paid_amount)}`]] : []),
                ['Paying now', `− ${formatMoney(pay)}`],
                [due - pay >= 0 ? 'Left on credit' : 'Customer’s money left', formatMoney(Math.abs(round2(due - pay)))],
              ].map(([label, value], i, arr) => (
                <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: i === arr.length - 1 ? 700 : 600 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={f.busy}>Hand over</Button>
      </DialogActions>
    </Dialog>
  );
}

// Money for a collected repair that was left on credit.
export function RepairPaymentDialog({ repair, onClose, onSaved }) {
  const notify = useNotify();
  const f = useForm({ payment_date: todayYmd(), amount: repair.balance_due, method: 'cash', reference_no: '', cheque_date: '', notes: '' });
  const value = Number(f.form.amount) || 0;
  const save = () => {
    if (!(value > 0)) { f.setErrors({ amount: 'Enter an amount above 0' }); return; }
    if (value > repair.balance_due + 0.005) { f.setErrors({ amount: `Only ${formatMoney(repair.balance_due)} is due` }); return; }
    f.submit(async () => {
      await api.post(`/repairs/${repair.id}/payments`, {
        payment_date: f.form.payment_date, notes: f.form.notes, ...paymentBody(f.form, value),
      });
      notify(`${formatMoney(value)} received for ${repair.repair_no}`);
      onSaved();
    });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Receive payment
        <Typography variant="body2" color="text.secondary">{repair.repair_no} · {repair.customer_name} · {formatMoney(repair.balance_due)} due</Typography>
      </DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>{f.field('amount', 'Amount', { ...amount, autoFocus: true, required: true })}</Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{f.field('payment_date', 'Date', dateProps)}</Grid>
          <PaymentFields f={f} />
          <Grid size={{ xs: 12 }}>{f.field('notes', 'Note')}</Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={f.busy}>Save receipt</Button>
      </DialogActions>
    </Dialog>
  );
}

export function CancelRepairDialog({ repair, onClose, onDone }) {
  const notify = useNotify();
  const f = useForm({ reason: '' });
  const save = () => f.submit(async () => {
    await api.post(`/repairs/${repair.id}/cancel`, { reason: f.form.reason });
    notify(`${repair.repair_no} cancelled`);
    onDone();
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel {repair.repair_no}</DialogTitle>
      <DialogContent>
        {f.error && <Alert severity="error" sx={{ mb: 2 }}>{f.error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The item goes back to {repair.customer_name} without repair.
          {repair.status === 'with_craftsman' && ` Get it back from ${repair.craftsman_name} first.`}
          {Number(repair.extra_gold_g) > 0 && ` The ${formatWeight(repair.extra_gold_g)} of shop gold comes back from him.`}
          {repair.paid_amount > 0 && ` The advance of ${formatMoney(repair.paid_amount)} becomes the customer’s advance for the next bill; to give it back, cancel its receipt.`}
        </Typography>
        {f.field('reason', 'Reason', { autoFocus: true })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep repair</Button>
        <Button variant="contained" color="error" onClick={save} disabled={f.busy}>Cancel repair</Button>
      </DialogActions>
    </Dialog>
  );
}
