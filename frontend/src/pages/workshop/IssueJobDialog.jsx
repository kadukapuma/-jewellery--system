import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatWeight } from '../../utils/pricing';
import { todayYmd } from '../../utils/payments';
import { gold } from '../../theme';

// Give gold to a craftsman for a new piece.
export default function IssueJobDialog({ onClose, onSaved }) {
  const notify = useNotify();
  const [craftsmen, setCraftsmen] = useState([]);
  const [categories, setCategories] = useState([]);
  const [karats, setKarats] = useState([]);
  const [source, setSource] = useState('loose'); // loose | stock
  const [lookup, setLookup] = useState('');
  const [sourceItem, setSourceItem] = useState(null);
  const [form, setForm] = useState({
    craftsman_id: '', category_id: '', karat_id: '', description: '', issue_date: todayYmd(),
    issued_weight_g: '', making_charge: '', craftsman_fee: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/craftsmen'), api.get('/categories'), api.get('/karats')])
      .then(([c, cat, k]) => {
        setCraftsmen(c.data.filter((x) => x.is_active));
        setCategories(cat.data.filter((x) => x.is_active && x.category_type !== 'biscuit'));
        setKarats(k.data.filter((x) => x.is_active));
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const findSource = async () => {
    const code = lookup.trim();
    if (!code) return;
    try {
      const res = await api.get(`/items/lookup/${encodeURIComponent(code)}`);
      const item = res.data;
      if (item.status !== 'in_stock' || item.stock_qty < 1) throw new Error(`${item.item_code} is not in stock`);
      setSourceItem(item);
      setForm((f) => ({ ...f, karat_id: item.karat_id, issued_weight_g: item.net_weight_g }));
      setErrors((e) => ({ ...e, source: undefined }));
    } catch (err) {
      setSourceItem(null);
      setErrors((e) => ({ ...e, source: err.response ? errorMessage(err) : err.message }));
    }
  };

  const save = async () => {
    setError('');
    const e = {};
    if (!form.craftsman_id) e.craftsman_id = 'Choose a craftsman';
    if (!form.category_id) e.category_id = 'Choose what is being made';
    if (!form.karat_id) e.karat_id = 'Choose a karat';
    if (!(Number(form.issued_weight_g) > 0)) e.issued_weight_g = 'Enter the gold weight';
    if (source === 'stock' && !sourceItem) e.source = 'Find the gold item by barcode';
    if (sourceItem && Number(form.issued_weight_g) > Number(sourceItem.net_weight_g)) e.issued_weight_g = `At most ${formatWeight(sourceItem.net_weight_g)}`;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/craft-jobs', {
        ...form,
        issued_weight_g: Number(form.issued_weight_g),
        making_charge: Number(form.making_charge) || 0,
        craftsman_fee: Number(form.craftsman_fee) || 0,
        source_item_id: source === 'stock' ? sourceItem.id : null,
      });
      notify(`${res.data.job_no}: ${formatWeight(res.data.issued_weight_g)} given to ${res.data.craftsman_name}`);
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
  const grams = { type: 'number', slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } } };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Give gold to a craftsman</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('craftsman_id', 'Craftsman', { select: true, required: true, autoFocus: true, children: craftsmen.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('issue_date', 'Date given', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('category_id', 'Making a…', { select: true, required: true, children: categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>{field('description', 'Description', { placeholder: 'Ladies ring, size 7' })}</Grid>

          <Grid size={{ xs: 12 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Gold given</Typography>
            <ToggleButtonGroup size="small" exclusive value={source} onChange={(e, v) => { if (v) { setSource(v); setSourceItem(null); } }}>
              <ToggleButton value="loose">Loose gold</ToggleButton>
              <ToggleButton value="stock">A biscuit / piece from stock</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          {source === 'stock' && (
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <TextField label="Barcode or item code" value={lookup} onChange={(e) => { setLookup(e.target.value); setSourceItem(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && findSource()} onBlur={findSource}
                  error={!!errors.source} helperText={errors.source || 'Scan or type, then Enter'} sx={{ maxWidth: 240 }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
                {sourceItem && (
                  <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{sourceItem.item_code} · {sourceItem.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {sourceItem.karat_name} · {formatWeight(sourceItem.net_weight_g)} · one unit leaves stock ({sourceItem.stock_qty} now)
                    </Typography>
                  </Box>
                )}
              </Box>
            </Grid>
          )}
          <Grid size={{ xs: 6 }}>
            {field('karat_id', 'Karat', { select: true, required: true, disabled: !!sourceItem, children: karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 6 }}>{field('issued_weight_g', 'Gold weight given', { required: true, ...grams })}</Grid>
          <Grid size={{ xs: 6 }}>
            {field('craftsman_fee', 'Craftsman fee', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'What you pay them (can change later)' })}
          </Grid>
          <Grid size={{ xs: 6 }}>
            {field('making_charge', 'Making charge', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'Charged to the customer' })}
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Give gold</Button>
      </DialogActions>
    </Dialog>
  );
}
