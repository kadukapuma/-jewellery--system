import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { gold, ink, stone } from '../theme';

const BAR = gold[600]; // validated against white: lightness, chroma, 3:1 contrast

// One series of bars with a hover tooltip. data: [{ key, label, value, detail? }]
export default function BarChart({ data, height = 200, format = (v) => v, emptyText = 'No data in this period' }) {
  const [hover, setHover] = useState(null);
  if (!data.length) {
    return (
      <Box sx={{ height: 120, display: 'grid', placeItems: 'center', bgcolor: stone[50], borderRadius: '20px', color: 'text.secondary' }}>
        <Typography variant="body2">{emptyText}</Typography>
      </Box>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const labelEvery = Math.ceil(data.length / 10);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 40 ? '2px' : 0.75, height, borderBottom: `1px solid ${stone[200]}` }}>
        {data.map((d, i) => (
          <Box
            key={d.key}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default', minWidth: 0 }}
          >
            <Box
              sx={{
                width: '100%', maxWidth: 28, borderRadius: '4px 4px 0 0',
                height: `${Math.max(1.5, (d.value / max) * 100)}%`,
                bgcolor: BAR, opacity: hover === null || hover === i ? 1 : 0.45, transition: 'opacity .1s',
              }}
            />
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: data.length > 40 ? '2px' : 0.75, mt: 0.5 }}>
        {data.map((d, i) => (
          <Typography key={d.key} variant="caption" color="text.secondary"
            sx={{ flex: 1, textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap', overflow: 'visible', visibility: i % labelEvery === 0 ? 'visible' : 'hidden', fontSize: 10.5 }}>
            {d.label}
          </Typography>
        ))}
      </Box>
      {hover !== null && (
        <Box
          sx={{
            position: 'absolute', top: 0, pointerEvents: 'none', bgcolor: ink, color: '#fff', borderRadius: '10px', px: 1.25, py: 0.75,
            fontSize: 12, whiteSpace: 'nowrap', left: `${((hover + 0.5) / data.length) * 100}%`,
            transform: hover / data.length > 0.7 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
          }}
        >
          <Box sx={{ opacity: 0.7 }}>{data[hover].label}</Box>
          <Box sx={{ fontWeight: 700 }}>{format(data[hover].value)}</Box>
          {data[hover].detail && <Box sx={{ opacity: 0.8 }}>{data[hover].detail}</Box>}
        </Box>
      )}
    </Box>
  );
}
