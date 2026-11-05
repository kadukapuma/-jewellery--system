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
      <Typography variant="caption">Developed by Kreethya (Pvt) Ltd.&copy; {new Date().getFullYear()} All rights reserved.</Typography>
    
      <Typography variant="caption" sx={{ display: 'block' }}>
      <a href="https://www.kreethya.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>www.kreethya.com</a>
      </Typography>
    </Box>
  );
}
