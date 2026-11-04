import { Box, InputAdornment, TextField, Typography } from '@mui/material';
import { formatMoney } from '../utils/format';
import { priceAtPercent } from '../utils/pricing';

// Min / max selling price as % above the final price (gold value + making).
// Being percentages, the prices follow the gold price automatically every day.
//   final: number | null; minPercent / maxPercent: numbers; onChange(field, percent)
//   errors: { price_min_percent?, price_max_percent? }; cost: unit cost for the profit hint (optional)
export default function PriceRangeFields({ final, minPercent, maxPercent, onChange, errors = {}, cost = null, row = false, note = true }) {
  const percents = { price_min_percent: minPercent, price_max_percent: maxPercent };
  const minPrice = final === null ? null : priceAtPercent(final, minPercent);
  const maxPrice = final === null ? null : priceAtPercent(final, maxPercent);
  const prices = { price_min_percent: minPrice, price_max_percent: maxPrice };

  const box = (field, label) => (
    <TextField
      label={label}
      type="number"
      value={percents[field]}
      onChange={(e) => onChange(field, e.target.value === '' ? '' : Number(e.target.value))}
      error={!!errors[field]}
      helperText={errors[field] || (final !== null ? `= ${formatMoney(prices[field])} today` : 'Above the final price')}
      slotProps={{
        htmlInput: { min: 0, max: 1000, step: 'any' },
        input: { startAdornment: <InputAdornment position="start">+</InputAdornment>, endAdornment: <InputAdornment position="end">%</InputAdornment> },
      }}
    />
  );

  return (
    <>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: row ? { xs: '1fr', sm: '1fr 1fr' } : '1fr' }}>
        {box('price_max_percent', 'Max price')}
        {box('price_min_percent', 'Min price')}
      </Box>
      {note && final !== null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {Number(maxPercent) === Number(minPercent) ? 'Min and max are the same – no discount.' : `Biggest discount today: ${formatMoney(maxPrice - minPrice)}.`}
          {cost !== null && cost > 0 && ` Profit at min ${formatMoney(minPrice - cost)}, at max ${formatMoney(maxPrice - cost)}.`}
        </Typography>
      )}
    </>
  );
}

// Same rules as the server: 0–1000 %, min not below the final price (0%), max not below min.
export function priceRangeErrors(minPercent, maxPercent) {
  const e = {};
  const check = (v) => {
    if (v === '' || Number.isNaN(Number(v))) return 'Enter a percentage (0 = final price)';
    if (Number(v) < 0) return 'Cannot be below the final price (0%)';
    if (Number(v) > 1000) return 'At most 1000%';
    return null;
  };
  const minProblem = check(minPercent);
  const maxProblem = check(maxPercent);
  if (minProblem) e.price_min_percent = minProblem;
  if (maxProblem) e.price_max_percent = maxProblem;
  else if (!minProblem && Number(maxPercent) < Number(minPercent)) e.price_max_percent = 'Cannot be below the min %';
  return e;
}
