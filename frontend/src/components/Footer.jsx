import { Box, Typography } from '@mui/material';

export default function Footer({ dark = false }) {
  return (
    <Box
      component="footer"
      sx={{
        px: { xs: 2, md: 4 },
        py: 2,
        textAlign: 'center',
        color: dark ? 'rgba(255,255,255,.65)' : 'text.secondary',
      }}
    >
      <Typography variant="caption">Developed by Kreethya Pvt Ltd</Typography>
    </Box>
  );
}
