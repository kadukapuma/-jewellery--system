import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment,
  TextField, Typography,
} from '@mui/material';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatMoney } from '../../utils/format';
import { calcItemPrice, formatWeight } from '../../utils/pricing';
import { todayYmd } from '../../utils/payments';
import { gold } from '../../theme';

// Receive the finished piece: wastage = gold given − finished weight.
export default function CompleteJobDialog({ job, onClose, onSaved }) {
  const { can } = useAuth();
  const notify = useNotify();
  const [gramPrice, setGramPrice] = useState(null);
  const [printAfter, setPrintAfter] = useState(true);
  const [form, setForm] = useState({
    returned_weight_g: '',
    item_name: job.description || job.category_name,
    item_code: '',
    making_charge: job.making_charge ?? 0,
    craftsman_fee: job.craftsman_fee ?? 0,
    completed_date: todayYmd(),
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const issued = Number(job.issued_weight_g);

  useEffect(() => {
    if (!can('gold_prices.view')) return;
    api.get('/gold-prices/current')
      .then((res) => setGramPrice(res.data.prices.find((p) => p.karat_id === job.karat_id)?.gram_price ?? null))
      .catch(() => {});
  }, [can, job.karat_id]);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const returned = Number(form.returned_weight_g) || 0;
  const wastage = returned > 0 ? Math.round((issued - returned) * 1000) / 1000 : null;
  const wastagePct = wastage !== null ? Math.round((wastage / issued) * 10000) / 100 : null;
  const price = returned > 0 && returned <= issued && gramPrice !== null
    ? calcItemPrice({ net_weight_g: returned, wastage_g: wastage, making_charge: form.making_charge }, gramPrice)
    : null;

  const save = async () => {
    setError('');
    const e = {};
    if (!(returned > 0)) e.returned_weight_g = 'Enter the weight of the finished piece';
    else if (returned > issued) e.returned_weight_g = `Cannot be more than the ${formatWeight(issued)} given`;
    if (!form.item_name.trim()) e.item_name = 'Name the finished item';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post(`/craft-jobs/${job.id}/complete`, {
        ...form,
        returned_weight_g: returned,
        making_charge: Number(form.making_charge) || 0,
        craftsman_fee: Number(form.craftsman_fee) || 0,
      });
      notify(`${job.job_no} received – item ${res.data.job.finished_item_code} is in stock`);
      onSaved(res.data, printAfter && can('tags.print'));
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
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Receive finished piece – {job.job_no}
        <Typography variant="body2" color="text.secondary">
          {job.craftsman_name} · {job.karat_name} · {formatWeight(issued)} given on {job.issue_date}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={3} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('returned_weight_g', 'Finished weight', {
                  required: true, autoFocus: true, type: 'number',
                  slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } },
                  helperText: 'Weigh the piece',
                })}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>{field('completed_date', 'Date received', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}</Grid>
              <Grid size={{ xs: 12, sm: 8 }}>{field('item_name', 'Item name', { required: true })}</Grid>
              <Grid size={{ xs: 12, sm: 4 }}>{field('item_code', 'Item code', { placeholder: 'Auto' })}</Grid>
              <Grid size={{ xs: 6 }}>{field('making_charge', 'Making charge', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'Customer pays' })}</Grid>
              <Grid size={{ xs: 6 }}>{field('craftsman_fee', 'Craftsman fee', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'Added to what you owe them' })}</Grid>
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '20px', p: 2.5 }}>
              {[
                ['Gold given', formatWeight(issued)],
                ['Finished piece', returned > 0 ? formatWeight(returned) : '—'],
                ['Wastage', wastage !== null ? `${formatWeight(wastage)} (${wastagePct}%)` : '—'],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: label === 'Wastage' && wastage < 0 ? 'error.main' : undefined }}>{value}</Typography>
                </Box>
              ))}
              {price && (
                <>
                  <Box sx={{ borderTop: `1px solid ${gold[200]}`, mt: 1, pt: 1 }}>
                    <Typography variant="caption" color="text.secondary">Customer price at today’s rate</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatWeight(price.billed_weight_g)} × {formatMoney(gramPrice)} + {formatMoney(price.making_charge)}
                    </Typography>
                    <Typography sx={{ fontWeight: 700, fontSize: 22, color: gold[800] }}>{formatMoney(price.line_total)}</Typography>
                  </Box>
                </>
              )}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        {can('tags.print') && (
          <FormControlLabel sx={{ mr: 'auto', ml: 1 }} label="Print tag after saving"
            control={<Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} />} />
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Receive piece</Button>
      </DialogActions>
    </Dialog>
  );
}
