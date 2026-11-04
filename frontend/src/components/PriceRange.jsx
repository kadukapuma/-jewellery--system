import { Typography } from '@mui/material';
import { formatMoney } from '../utils/format';

// Selling price today (max) with the lowest discount price (min) underneath.
export default function PriceRange({ item, missingColor = 'text.secondary' }) {
  if (item.price_now === null) return <Typography variant="caption" color={missingColor}>No gold price</Typography>;
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatMoney(item.price_max_now)}</Typography>
      {item.price_min_now < item.price_max_now && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>min {formatMoney(item.price_min_now)}</Typography>
      )}
    </>
  );
}
