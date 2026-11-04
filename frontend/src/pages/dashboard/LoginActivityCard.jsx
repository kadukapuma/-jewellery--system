import { Box, ButtonBase, Typography } from '@mui/material';
import LoginIcon from '@mui/icons-material/LoginOutlined';
import { gold } from '../../theme';

const PERIODS = [7, 14, 30];

function shortDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Big gold card: total logins + one bar per day, the busiest day highlighted.
export default function LoginActivityCard({ logins, days, onDaysChange }) {
  const daily = logins.daily;
  const total = daily.reduce((s, d) => s + d.success, 0);
  const max = Math.max(1, ...daily.map((d) => d.success));
  const peakIndex = daily.findIndex((d) => d.success === max && max > 0);
  const labelEvery = Math.ceil(daily.length / 7);

  return (
    <Box
      sx={{
        background: `linear-gradient(155deg, ${gold[600]} 0%, ${gold[700]} 45%, ${gold[800]} 100%)`,
        color: '#fff',
        borderRadius: '32px',
        p: { xs: 2.5, md: 4 },
        height: '100%',
        minHeight: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center' }}>
              <LoginIcon fontSize="small" />
            </Box>
            <Typography sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 600 }}>Login activity</Typography>
          </Box>
          <Typography sx={{ mt: 1, color: 'rgba(255,255,255,.75)', fontSize: 14, maxWidth: 380 }}>
            Successful logins per day over the last {days} days.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: 'rgba(255,255,255,.12)', borderRadius: 999 }}>
          {PERIODS.map((p) => (
            <ButtonBase
              key={p}
              onClick={() => onDaysChange(p)}
              sx={{
                width: 48, height: 36, borderRadius: 999, fontWeight: 600, fontSize: 13,
                bgcolor: p === days ? '#fff' : 'transparent',
                color: p === days ? gold[800] : '#fff',
              }}
            >
              {p}D
            </ButtonBase>
          ))}
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px 1fr' }, alignItems: 'end', gap: 2, mt: 3 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: 64, md: 88 }, fontWeight: 500, lineHeight: 0.9, letterSpacing: -4 }}>{total}</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,.8)', mt: 1 }}>logins</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 0.5, md: 1 }, height: 230, pt: 6, minWidth: 0 }}>
          {daily.map((d, i) => {
            const isPeak = i === peakIndex;
            return (
              <Box key={d.date} title={`${shortDate(d.date)}: ${d.success} logins, ${d.failed} failed`}
                sx={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', minWidth: 0 }}>
                {isPeak && (
                  <Box sx={{ position: 'absolute', bottom: `calc(${(d.success / max) * 100}% + 8px)`, bgcolor: '#fff', color: gold[900], borderRadius: 999, px: 1.5, py: 0.5, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.15)' }}>
                    {d.success}
                  </Box>
                )}
                <Box
                  sx={{
                    width: '100%', maxWidth: 12, borderRadius: 999,
                    height: `${Math.max(3, (d.success / max) * 100)}%`,
                    bgcolor: isPeak ? '#fff' : 'rgba(255,255,255,.35)',
                  }}
                />
                <Typography sx={{ position: 'absolute', bottom: -22, fontSize: 10.5, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', visibility: i % labelEvery === 0 || i === daily.length - 1 ? 'visible' : 'hidden' }}>
                  {shortDate(d.date)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box sx={{ height: 20 }} />
    </Box>
  );
}
