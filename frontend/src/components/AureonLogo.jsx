import { Box, Typography } from '@mui/material';

export function AureonMark({ size = 36, sx }) {
  return (
    <Box
      component="img"
      src="/Logo.png"
      alt="Aureon"
      sx={{ width: size * 4.2, height: 'auto', display: 'block', flexShrink: 0, ...sx }}
    />
  );
}

export default function AureonLogo({ size = 36, tone = 'light', tagline = false, sx }) {
  const textColor = tone === 'dark' ? '#F3D98B' : '#8B6B1F';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', ...sx }}>
      <AureonMark size={size} />
      {tagline && (
        <Typography sx={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: size * 0.3, color: textColor, opacity: 0.8, mt: 0.4, alignSelf: 'center' }}>
          by Kreethya
        </Typography>
      )}
    </Box>
  );
}
