import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, MenuItem, Switch,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import FormSection from '../../components/FormSection';
import TextField from '../../components/TextField';
import SearchIcon from '@mui/icons-material/Search';
import ListIcon from '@mui/icons-material/ManageSearch';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { formatWeight } from '../../utils/pricing';
import { todayYmd } from '../../utils/payments';
import { gold } from '../../theme';
import ItemPickerDialog from '../sales/ItemPickerDialog';

const round3 = (n) => Math.round(n * 1000) / 1000;

// What can be chosen as the saved item for each kind of work.
const SAVED_ITEM = {
  // Any saved item: one with 0 in stock gets filled in, one with stock gets one more piece.
  make_item: {
    params: { status: 'in_stock' },
    check: () => null,
    emptyText: 'No saved items match',
  },
  rework: {
    params: { status: 'in_stock', stock: 'available' },
    check: (i) => (i.status !== 'in_stock' || i.stock_qty < 1 ? `${i.item_code} is not in stock`
      : i.stock_qty > 1 ? `${i.item_code} has ${i.stock_qty} pieces. Only single pieces can be reworked.` : null),
    emptyText: 'No pieces in stock match',
  },
};

// The item that was found, shown under its barcode field.
function GoldBox({ item, children }) {
  return (
    <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.item_code} · {item.name}</Typography>
      <Typography variant="caption" color="text.secondary">{children}</Typography>
    </Box>
  );
}

// Give gold to a craftsman: for a new piece, to make a saved item, or with one of our stock pieces to repair.
// (A customer's own item to repair goes through Customer Repairs.)
export default function IssueJobDialog({ onClose, onSaved }) {
  const notify = useNotify();
  const [craftsmen, setCraftsmen] = useState([]);
  const [categories, setCategories] = useState([]);
  const [karats, setKarats] = useState([]);
  const [jobType, setJobType] = useState('new'); // new | make_item | rework
  const [savedLookup, setSavedLookup] = useState('');
  const [savedItem, setSavedItem] = useState(null);
  const [picking, setPicking] = useState(false);
  const [source, setSource] = useState('loose'); // loose | stock
  const [lookup, setLookup] = useState('');
  const [sourceItem, setSourceItem] = useState(null);
  const [form, setForm] = useState({
    craftsman_id: '', category_id: '', karat_id: '', description: '', issue_date: todayYmd(),
    target_weight_g: '', issued_weight_g: '', extra_weight_g: '', making_charge: '', craftsman_fee: '',
  });
  const [useHeld, setUseHeld] = useState(true); // use the gold he already holds for this job
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

  const changeType = (type) => {
    if (!type) return;
    setJobType(type);
    setSavedItem(null);
    setSavedLookup('');
    setSource('loose');
    setSourceItem(null);
    setErrors({});
    setForm((f) => ({ ...f, category_id: '', karat_id: '', description: '', issued_weight_g: '', extra_weight_g: '' }));
  };

  const chooseSaved = (item) => {
    const problem = SAVED_ITEM[jobType].check(item);
    if (problem) {
      setSavedItem(null);
      setErrors((e) => ({ ...e, item_id: problem }));
      return;
    }
    setSavedItem(item);
    setSavedLookup(item.item_code);
    setSourceItem(null);
    setForm((f) => ({ ...f, category_id: item.category_id, karat_id: item.karat_id, description: f.description || item.name }));
    setErrors((e) => ({ ...e, item_id: undefined, category_id: undefined, karat_id: undefined }));
  };

  const findItem = async (code, onFound, errorKey) => {
    if (!code.trim()) return;
    try {
      const res = await api.get(`/items/lookup/${encodeURIComponent(code.trim())}`);
      onFound(res.data);
    } catch (err) {
      setErrors((e) => ({ ...e, [errorKey]: errorMessage(err) }));
    }
  };

  const findSource = () => findItem(lookup, (item) => {
    if (item.status !== 'in_stock' || item.stock_qty < 1) {
      setSourceItem(null);
      setErrors((e) => ({ ...e, source: `${item.item_code} is not in stock` }));
      return;
    }
    if (savedItem && item.karat_id !== savedItem.karat_id) {
      setSourceItem(null);
      setErrors((e) => ({ ...e, source: `${item.item_code} is ${item.karat_name}; ${savedItem.item_code} is ${savedItem.karat_name}` }));
      return;
    }
    setSourceItem(item);
    // Keeps the gold for the job if it is already entered.
    setForm((f) => ({ ...f, karat_id: item.karat_id, issued_weight_g: f.issued_weight_g || item.net_weight_g }));
    setErrors((e) => ({ ...e, source: undefined }));
  }, 'source');

  const rework = jobType === 'rework';
  const usesSaved = jobType !== 'new';
  const extra = Number(form.extra_weight_g) || 0;
  const reworkTotal = rework && savedItem ? round3(Number(savedItem.net_weight_g) + extra) : null;
  // Gold the chosen craftsman still holds from before; part of it can go into this job.
  const craftsman = craftsmen.find((c) => c.id === form.craftsman_id);
  // Held gold is kept per karat: only gold of the job's karat can go into it.
  const heldList = (craftsman?.gold_by_karat || []).filter((g) => g.gold_g > 0);
  const karatName = karats.find((k) => k.id === form.karat_id)?.name || savedItem?.karat_name || '';
  const holds = form.karat_id ? Math.max(0, heldList.find((g) => g.karat_id === form.karat_id)?.gold_g ?? 0) : 0;
  const heldOther = heldList.filter((g) => g.karat_id !== form.karat_id);
  const looseGiven = rework ? extra : Number(form.issued_weight_g) || 0; // what held gold can stand in for
  // His gold is used first (unless switched off); only the rest is new gold from the shop.
  const heldUsed = useHeld ? round3(Math.min(holds, looseGiven)) : 0;
  const newGold = round3(looseGiven - heldUsed);
  const enoughHeld = useHeld && holds > 0 && looseGiven > 0 && newGold <= 0;
  const target = Number(form.target_weight_g) || 0;
  const totalGiven = rework ? reworkTotal ?? 0 : looseGiven;

  const save = async () => {
    setError('');
    const e = {};
    if (!form.craftsman_id) e.craftsman_id = 'Choose a craftsman';
    if (usesSaved && !savedItem) e.item_id = 'Find the saved item by barcode, or Select item';
    if (!usesSaved && !form.category_id) e.category_id = 'Choose what is being made';
    if (!usesSaved && !form.karat_id) e.karat_id = 'Choose a karat';
    if (!rework && !(Number(form.issued_weight_g) > 0)) e.issued_weight_g = 'Enter the gold weight';
    if (rework && extra < 0) e.extra_weight_g = 'Cannot be negative';
    if (!rework && source === 'stock' && !sourceItem && !enoughHeld) e.source = 'Find the gold item by barcode';
    if (form.target_weight_g !== '' && !(target > 0)) e.target_weight_g = 'Weight must be above 0';
    else if (target > 0 && totalGiven > 0 && target > totalGiven) e.target_weight_g = `Cannot be more than the gold for the job (${formatWeight(totalGiven)})`;
    if (sourceItem && newGold > Number(sourceItem.net_weight_g)) e.issued_weight_g = `At most ${formatWeight(round3(Number(sourceItem.net_weight_g) + heldUsed))}`;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await api.post('/craft-jobs', {
        ...form,
        job_type: jobType,
        item_id: savedItem?.id ?? null,
        category_id: usesSaved ? null : form.category_id,
        karat_id: usesSaved ? null : form.karat_id,
        issued_weight_g: rework ? null : Number(form.issued_weight_g),
        extra_weight_g: rework ? extra : 0,
        target_weight_g: target > 0 ? target : null,
        use_held_gold: useHeld,
        making_charge: Number(form.making_charge) || 0,
        craftsman_fee: Number(form.craftsman_fee) || 0,
        source_item_id: !rework && source === 'stock' && !enoughHeld ? sourceItem.id : null,
      });
      const heldNote = heldUsed > 0 ? ` (${formatWeight(heldUsed)} from gold he already had)` : '';
      notify(rework
        ? `${res.data.job_no}: ${savedItem.item_code} given to ${res.data.craftsman_name}${heldNote}`
        : `${res.data.job_no}: ${formatWeight(res.data.issued_weight_g)} given to ${res.data.craftsman_name}${heldNote}`);
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
  // A saved item's category may be one the "Making a…" list leaves out (e.g. inactive), so it is always listed.
  const categoryOptions = savedItem && !categories.some((c) => c.id === savedItem.category_id)
    ? [...categories, { id: savedItem.category_id, name: savedItem.category_name }]
    : categories;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Give work to a craftsman</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormSection title="Type of work">
          <Grid size={{ xs: 12 }}>
            <ToggleButtonGroup size="small" exclusive fullWidth value={jobType} onChange={(e, v) => changeType(v)}>
              <ToggleButton value="new">Make a new piece</ToggleButton>
              <ToggleButton value="make_item">Make a saved item</ToggleButton>
              <ToggleButton value="rework">Repair our item</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {jobType === 'new' && 'The finished piece becomes a new item.'}
              {jobType === 'make_item' && 'Make a piece of an item already saved. It fills in an item with 0 in stock, or adds 1 more to its stock.'}
              {jobType === 'rework' && 'One of our stock pieces goes to the craftsman (resize / polish / fix) and comes back as the same item, same barcode. Customer items go through Customer Repairs.'}
            </Typography>
          </Grid>
        </FormSection>

        {usesSaved && (
          <FormSection title={rework ? 'Piece to repair' : 'Saved item'}>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField label="Barcode or code" value={savedLookup}
                onChange={(e) => { setSavedLookup(e.target.value); setSavedItem(null); setErrors((x) => ({ ...x, item_id: undefined })); }}
                onKeyDown={(e) => e.key === 'Enter' && findItem(savedLookup, chooseSaved, 'item_id')}
                onBlur={() => !savedItem && findItem(savedLookup, chooseSaved, 'item_id')}
                error={!!errors.item_id} helperText={errors.item_id || 'Scan or type, then Enter'}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 'auto' }}>
              <Button variant="outlined" startIcon={<ListIcon />} onClick={() => setPicking(true)} sx={{ height: 40 }}>Select item</Button>
            </Grid>
            {savedItem && (
              <Grid size={{ xs: 12 }}>
                <GoldBox item={savedItem}>
                  {savedItem.category_name} · {savedItem.karat_name}
                  {rework ? ` · ${formatWeight(savedItem.net_weight_g)} · leaves stock until it comes back`
                    : savedItem.stock_qty > 0 ? ` · ${savedItem.stock_qty} in stock · the finished piece adds 1 more`
                      : ' · weight is filled in when it comes back'}
                </GoldBox>
              </Grid>
            )}
          </FormSection>
        )}

        <FormSection title="Craftsman & piece">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('craftsman_id', 'Craftsman', { select: true, required: true, autoFocus: !usesSaved, children: craftsmen.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('issue_date', 'Date given', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('category_id', 'Making a…', { select: true, required: !usesSaved, disabled: usesSaved, children: categoryOptions.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('description', rework ? 'Work to do' : 'Description', { placeholder: rework ? 'Resize to 7, polish' : 'Ladies ring, size 7' })}
          </Grid>
        </FormSection>

        <FormSection title="Weight & gold">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('karat_id', 'Karat', { select: true, required: !usesSaved, disabled: !!sourceItem || usesSaved, children: karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>) })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('target_weight_g', rework ? 'Weight wanted after the work' : 'Piece weight wanted', {
              ...grams, helperText: 'Exact weight of the finished piece; compared when it comes back',
            })}
          </Grid>
          {rework ? (
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('extra_weight_g', 'Extra gold added', {
                ...grams, placeholder: '0',
                helperText: reworkTotal !== null ? `Total with the piece ${formatWeight(reworkTotal)} (piece ${formatWeight(savedItem.net_weight_g)})` : 'Gold, if any',
              })}
            </Grid>
          ) : (
            <Grid size={{ xs: 12, sm: 6 }}>
              {field('issued_weight_g', 'Gold for the job', {
                required: true, ...grams,
                helperText: target > 0 && looseGiven >= target ? `Allows ${formatWeight(round3(looseGiven - target))} for wastage` : 'Piece weight + wastage allowance',
              })}
            </Grid>
          )}

          {holds > 0 && (
            <Grid size={{ xs: 12 }}>
              <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1.2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {craftsman.name} already holds {formatWeight(holds)} of {karatName}
                  </Typography>
                  <FormControlLabel sx={{ mr: 0 }} label={<Typography variant="body2">Use the gold he already has</Typography>}
                    control={<Switch size="small" checked={useHeld} onChange={(e) => setUseHeld(e.target.checked)} />} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {!useHeld
                    ? `Not used · all ${looseGiven > 0 ? formatWeight(looseGiven) + ' ' : ''}gold for this job is new · his ${formatWeight(holds)} stays with him`
                    : looseGiven > 0
                    ? enoughHeld
                      ? `All ${formatWeight(looseGiven)} comes from his gold · no new gold to give · ${formatWeight(round3(holds - heldUsed))} stays with him`
                      : `${formatWeight(heldUsed)} from his gold (all he has) · give ${formatWeight(newGold)} of new gold`
                    : `His gold is used first for this job${rework ? '' : '; enter the gold for the job'}`}
                </Typography>
              </Box>
            </Grid>
          )}
          {heldList.length > 0 && holds === 0 && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary">
                {craftsman.name} holds {heldList.map((g) => `${formatWeight(g.gold_g)} of ${g.karat_name}`).join(', ')}
                {form.karat_id ? ` · none of ${karatName}, so it cannot be used for this job` : ' · choose the karat to use it'}
              </Typography>
            </Grid>
          )}
          {holds > 0 && heldOther.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary">
                Also holds {heldOther.map((g) => `${formatWeight(g.gold_g)} of ${g.karat_name}`).join(', ')} (other karats cannot be used here)
              </Typography>
            </Grid>
          )}

          {/* Where the new gold comes from; not needed when his own gold covers the job. */}
          {!rework && !enoughHeld && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {holds > 0 && useHeld ? 'New gold comes from' : 'Gold comes from'}
              </Typography>
              <ToggleButtonGroup size="small" exclusive value={source} onChange={(e, v) => { if (v) { setSource(v); setSourceItem(null); } }}>
                <ToggleButton value="loose">Loose gold</ToggleButton>
                <ToggleButton value="stock">A biscuit / piece from stock</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
          )}
          {!rework && !enoughHeld && source === 'stock' && (
            <>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField label="Barcode or item code" value={lookup} onChange={(e) => { setLookup(e.target.value); setSourceItem(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && findSource()} onBlur={findSource}
                  error={!!errors.source} helperText={errors.source || 'Scan or type, then Enter'}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
              </Grid>
              {sourceItem && (
                <Grid size={{ xs: 12, sm: 7 }}>
                  <GoldBox item={sourceItem}>
                    {sourceItem.karat_name} · {formatWeight(sourceItem.net_weight_g)} · one unit leaves stock ({sourceItem.stock_qty} now)
                  </GoldBox>
                </Grid>
              )}
            </>
          )}
        </FormSection>

        <FormSection title="Charges">
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('craftsman_fee', 'Craftsman fee', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'What you pay them (can change later)' })}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {field('making_charge', rework ? 'Making charge added' : 'Making charge', { type: 'number', slotProps: { htmlInput: { min: 0, step: 'any' } }, helperText: 'Charged to the customer' })}
          </Grid>
        </FormSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>{rework ? 'Give piece' : 'Give gold'}</Button>
      </DialogActions>
      {picking && (
        <ItemPickerDialog
          single
          title={rework ? 'Select our piece to repair' : 'Select the saved item to make'}
          params={SAVED_ITEM[jobType].params}
          canPick={(i) => !SAVED_ITEM[jobType].check(i)}
          emptyText={SAVED_ITEM[jobType].emptyText}
          onClose={() => setPicking(false)}
          onAdd={([item]) => { setPicking(false); chooseSaved(item); }}
        />
      )}
    </Dialog>
  );
}
