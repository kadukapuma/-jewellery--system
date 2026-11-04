import { useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { gold, ink, stone } from '../../theme';
import { formatAmount, formatDateTime, formatMoney } from '../../utils/format';

const LINE = gold[600]; // validated: lightness, chroma and 3:1 contrast on white
const H = 220;
const PAD = { top: 16, right: 12, bottom: 8, left: 12 };

function toTime(value) {
  return new Date(value.replace(' ', 'T')).getTime();
}

// One karat's pound price over time. Step line (a price holds until the next update),
// crosshair + tooltip on hover, min / max / latest labelled in text.
export default function PriceHistoryChart({ rows, karat }) {
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);

  const points = useMemo(
    () => [...rows].sort((a, b) => toTime(a.effective_at) - toTime(b.effective_at) || a.id - b.id)
      .map((r) => ({ ...r, t: toTime(r.effective_at) })),
    [rows],
  );

  if (points.length < 2) {
    return (
      <Box sx={{ height: 120, display: 'grid', placeItems: 'center', color: 'text.secondary', bgcolor: stone[50], borderRadius: '20px' }}>
        <Typography variant="body2">{points.length ? 'Only one price in this period — the chart needs at least two.' : 'No prices in this period.'}</Typography>
      </Box>
    );
  }

  const values = points.map((p) => p.pound_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.01 || 1;
  const yMin = min - span * 0.15;
  const yMax = max + span * 0.15;
  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, Date.now());
  const W = 1000; // viewBox width; the svg stretches horizontally

  const x = (t) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  // Step path: horizontal until the next price, then vertical.
  let d = `M ${x(points[0].t)} ${y(points[0].pound_price)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${x(points[i].t)} V ${y(points[i].pound_price)}`;
  }
  d += ` H ${x(t1)}`;

  const onMove = (e) => {
    const rect = boxRef.current.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0);
    let current = points[0];
    for (const p of points) if (p.t <= t) current = p;
    setHover({ point: current, px: ((e.clientX - rect.left) / rect.width) * 100 });
  };

  const latest = points[points.length - 1];

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1.5 }}>
        {[
          ['Latest', latest.pound_price],
          ['Highest', max],
          ['Lowest', min],
        ].map(([label, v]) => (
          <Box key={label}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography sx={{ fontWeight: 600 }}>{formatAmount(v)}</Typography>
          </Box>
        ))}
      </Box>
      <Box
        ref={boxRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${karat} pound price from ${formatAmount(min)} to ${formatAmount(max)}, latest ${formatAmount(latest.pound_price)}`}
        sx={{ position: 'relative', height: H, cursor: 'crosshair' }}
      >
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={PAD.top + f * (H - PAD.top - PAD.bottom)} y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
              stroke={stone[100]} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={d} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover && (
            <line x1={(hover.px / 100) * W} x2={(hover.px / 100) * W} y1={0} y2={H} stroke={stone[400]} strokeWidth={1}
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hover && (
          <Box
            sx={{
              position: 'absolute', top: 0, pointerEvents: 'none',
              left: `${hover.px}%`, transform: hover.px > 70 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
              bgcolor: ink, color: '#fff', borderRadius: '12px', px: 1.5, py: 1, fontSize: 12, whiteSpace: 'nowrap',
              boxShadow: '0 6px 18px rgba(0,0,0,.18)',
            }}
          >
            <Box sx={{ opacity: 0.7 }}>{formatDateTime(hover.point.effective_at)}</Box>
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>{formatAmount(hover.point.pound_price)} / pound</Box>
            <Box sx={{ opacity: 0.85 }}>{formatMoney(hover.point.gram_price)} / gram</Box>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{formatDateTime(points[0].effective_at)}</Typography>
        <Typography variant="caption" color="text.secondary">Now</Typography>
      </Box>
    </Box>
  );
}
