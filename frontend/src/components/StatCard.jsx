import { useNavigate } from 'react-router-dom';
import { Box, IconButton, Typography } from '@mui/material';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import { gold, ink, stone } from '../theme';

const TONES = {
  gold: { bg: gold[700], fg: '#fff', sub: 'rgba(255,255,255,.75)' },
  light: { bg: gold[100], fg: ink, sub: stone[600] },
  gray: { bg: '#7A746A', fg: '#fff', sub: 'rgba(255,255,255,.75)' },
};

const NOTCH = 68; // size of the white corner that holds the arrow button
const CURVE = 28;

// Number tile with a cut-out top-right corner holding a round arrow link.
// Sits on a white surface: the notch and its curves are painted white.
function Trend({ value, tone }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const flat = value === 0;
  const Icon = flat ? TrendingFlatIcon : up ? TrendingUpIcon : TrendingDownIcon;
  // Arrow + signed text carry the meaning; colour only reinforces it.
  const onDark = tone !== 'light';
  const color = flat ? 'inherit' : up ? (onDark ? '#B9F6CA' : '#1B7F3B') : (onDark ? '#FFCDD2' : '#B3261E');
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color, fontSize: 12, fontWeight: 600, mt: 0.5 }}>
      <Icon sx={{ fontSize: 16 }} />
      {value > 0 ? '+' : ''}{value}%
    </Box>
  );
}

export default function StatCard({ label, value, unit, note, trend, tone = 'gold', to, onClick }) {
  const navigate = useNavigate();
  const t = TONES[tone];
  const open = onClick || (to ? () => navigate(to) : null);
  const concave = { content: '""', position: 'absolute', width: CURVE, height: CURVE, bgcolor: 'transparent', pointerEvents: 'none' };

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        minHeight: 140,
        overflow: 'hidden', // keeps the white corner curves inside the card
        '&::before': { ...concave, top: 0, right: NOTCH, borderTopRightRadius: CURVE, boxShadow: `${CURVE / 2}px -${CURVE / 2}px 0 ${CURVE / 2}px #fff` },
        '&::after': { ...concave, top: NOTCH, right: 0, borderTopRightRadius: CURVE, boxShadow: `${CURVE / 2}px -${CURVE / 2}px 0 ${CURVE / 2}px #fff` },
      }}
    >
      <Box sx={{ bgcolor: t.bg, color: t.fg, borderRadius: '28px', p: 2.5, pr: 10, height: '100%', overflow: 'hidden' }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{label}</Typography>
        {note && <Typography sx={{ fontSize: 12, color: t.sub, mt: 0.25 }}>{note}</Typography>}
        <Trend value={trend} tone={tone} />
        <Box sx={{ display: 'flex', alignItems: 'flex-start', mt: 2 }}>
          <Typography sx={{ fontSize: { xs: 36, md: 42 }, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1 }}>{value}</Typography>
          {unit && <Typography sx={{ fontSize: 13, color: t.sub, ml: 0.75, mt: 0.5 }}>{unit}</Typography>}
        </Box>
      </Box>
      <Box
        sx={{
          position: 'absolute', top: 0, right: 0, width: NOTCH, height: NOTCH, bgcolor: '#fff',
          borderBottomLeftRadius: CURVE, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start',
        }}
      >
        <IconButton
          aria-label={`Open ${label}`}
          disabled={!open}
          onClick={open || undefined}
          sx={{ width: 54, height: 54, border: `1px solid ${stone[200]}`, color: ink }}
        >
          <NorthEastIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
