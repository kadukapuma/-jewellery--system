import { useEffect, useState } from 'react';
import { Alert, Box, Button, Grid, IconButton, InputAdornment, MenuItem, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import TextField from '../../components/TextField';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { gold, stone } from '../../theme';

// Old gold pieces a customer hands in, priced at net weight × today's gram price − the deduction %.
// The server prices them again when saving; these numbers are for the counter.

const round2 = (n) => Math.round(n * 100) / 100;
const grams = { type: 'number', slotProps: { htmlInput: { min: 0, step: '0.001' }, input: { endAdornment: <InputAdornment position="end">g</InputAdornment> } } };

export const emptyOldGoldLine = (setup) => ({
  description: '',
  category_id: setup?.categories?.[0]?.id ?? '',
  karat_id: setup?.karats?.find((k) => k.gram_price)?.id ?? '',
  gross_weight_g: '',
  stone_weight_g: '',
  value: '', // blank = the calculated value
});

// Karats with today's price, categories and the deduction %.
export function useOldGoldSetup() {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/old-gold/settings').then((r) => setSetup(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);
  return { setup, error };
}

export function priceLine(line, setup) {
  const karat = setup?.karats?.find((k) => k.id === line.karat_id);
  const gross = Number(line.gross_weight_g) || 0;
  const stones = Number(line.stone_weight_g) || 0;
  const net = Math.max(0, (Math.round(gross * 1000) - Math.round(stones * 1000)) / 1000);
  const rate = karat?.gram_price ?? null;
  const deduction = Number(setup?.deduction_percent) || 0;
  const calc = rate ? round2(net * rate * (1 - deduction / 100)) : 0;
  const typed = line.value === '' || line.value === null || line.value === undefined ? null : Number(line.value);
  return { net, rate, calc, value: typed ?? calc, typed, karatName: karat?.name || '' };
}

export function totalOf(lines, setup) {
  return lines.reduce((t, l) => {
    const p = priceLine(l, setup);
    return { net: Math.round((t.net + p.net) * 1000) / 1000, value: round2(t.value + p.value) };
  }, { net: 0, value: 0 });
}

// Checks the pieces before saving. Returns { errors: {`i.field`: msg}, ok }.
export function checkLines(lines, setup, isAdmin) {
  const errors = {};
  lines.forEach((l, i) => {
    const p = priceLine(l, setup);
    if (!l.description.trim()) errors[`${i}.description`] = 'Describe the piece';
    if (!l.category_id) errors[`${i}.category_id`] = 'Choose';
    if (!l.karat_id) errors[`${i}.karat_id`] = 'Choose';
    else if (!p.rate) errors[`${i}.karat_id`] = 'No gold price today';
    if (!(Number(l.gross_weight_g) > 0)) errors[`${i}.gross_weight_g`] = 'Weigh it';
    if ((Number(l.stone_weight_g) || 0) >= (Number(l.gross_weight_g) || 0) && Number(l.gross_weight_g) > 0) errors[`${i}.stone_weight_g`] = 'Too heavy';
    if (p.typed !== null && !(p.typed > 0)) errors[`${i}.value`] = 'Above 0';
    if (p.typed !== null && p.typed > p.calc + 0.009 && !isAdmin) errors[`${i}.value`] = `At most ${formatMoney(p.calc)}`;
  });
  return { errors, ok: !Object.keys(errors).length };
}

// What the API takes.
export const linesBody = (lines) => lines.map((l) => ({
  description: l.description.trim(),
  category_id: l.category_id,
  karat_id: l.karat_id,
  gross_weight_g: Number(l.gross_weight_g),
  stone_weight_g: Number(l.stone_weight_g) || 0,
  value: l.value === '' ? null : Number(l.value),
}));

export function OldGoldLinesEditor({ lines, onChange, setup, errors = {}, onClearError }) {
  const { user } = useAuth();
  const isAdmin = !!user?.is_super_admin;
  if (!setup) return null;
  const set = (i, key) => (e) => {
    const next = lines.map((l, j) => (j === i ? { ...l, [key]: e.target.value } : l));
    onChange(next);
    onClearError?.(`${i}.${key}`);
  };
  const err = (i, key) => errors[`${i}.${key}`];
  const total = totalOf(lines, setup);
  const noPrice = setup.karats.every((k) => !k.gram_price);

  return (
    <Box>
      {noPrice && <Alert severity="warning" sx={{ mb: 2 }}>No gold price has been entered. Update gold prices first.</Alert>}
      {lines.map((line, i) => {
        const p = priceLine(line, setup);
        return (
          <Box key={i} sx={{ border: `1px solid ${stone[200]}`, borderRadius: '16px', p: 2, mb: 1.5 }}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label={`Piece ${i + 1}`} value={line.description} onChange={set(i, 'description')} required placeholder="Old chain, broken bangle"
                  error={!!err(i, 'description')} helperText={err(i, 'description')} fullWidth />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Category" select value={line.category_id} onChange={set(i, 'category_id')} error={!!err(i, 'category_id')} helperText={err(i, 'category_id')} fullWidth>
                  {setup.categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Karat" select value={line.karat_id} onChange={set(i, 'karat_id')} error={!!err(i, 'karat_id')} helperText={err(i, 'karat_id')} fullWidth>
                  {setup.karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}{k.gram_price ? '' : ' (no price)'}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Weight" {...grams} value={line.gross_weight_g} onChange={set(i, 'gross_weight_g')} required
                  error={!!err(i, 'gross_weight_g')} helperText={err(i, 'gross_weight_g')} fullWidth />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Stones" {...grams} value={line.stone_weight_g} onChange={set(i, 'stone_weight_g')}
                  error={!!err(i, 'stone_weight_g')} helperText={err(i, 'stone_weight_g') || 'Not paid for'} fullWidth />
              </Grid>
              <Grid size={{ xs: 10, sm: 5 }}>
                <TextField label="Value given" type="number" value={line.value} onChange={set(i, 'value')}
                  placeholder={p.calc ? p.calc.toFixed(2) : ''} slotProps={{ htmlInput: { min: 0, step: 'any' }, inputLabel: { shrink: true } }}
                  error={!!err(i, 'value')} fullWidth
                  helperText={err(i, 'value') || (p.typed !== null && p.typed < p.calc ? `${formatMoney(p.calc - p.typed)} below the rate` : isAdmin ? 'Blank = by the rate' : 'Blank = by the rate. Can only go lower.')} />
              </Grid>
              <Grid size={{ xs: 2, sm: 1 }} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', pt: 1 }}>
                {lines.length > 1 && (
                  <Tooltip title="Remove piece">
                    <IconButton size="small" onClick={() => onChange(lines.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                )}
              </Grid>
            </Grid>
            {p.rate && p.net > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {formatWeight(p.net)} × {formatMoney(p.rate)} / g{Number(setup.deduction_percent) > 0 ? ` − ${setup.deduction_percent}%` : ''} = <b>{formatMoney(p.calc)}</b>
              </Typography>
            )}
          </Box>
        );
      })}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...lines, emptyOldGoldLine(setup)])} disabled={lines.length >= 50}>Add piece</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ bgcolor: gold[50], border: `1px solid ${gold[200]}`, borderRadius: '14px', px: 2, py: 1, textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">{formatWeight(total.net)} net gold</Typography>
          <Typography sx={{ fontWeight: 700 }}>{formatMoney(total.value)}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
