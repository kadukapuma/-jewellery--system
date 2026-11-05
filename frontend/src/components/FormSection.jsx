import { Box, Grid, Typography } from '@mui/material';
import { gold, stone } from '../theme';

// A labelled group of fields inside a form popup. Children are Grid items.
export default function FormSection({ title, hint, children, sx }) {
  return (
    <Box sx={[{ '& + &': { mt: 3, pt: 3, borderTop: `1px dashed ${stone[200]}` } }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: gold[800] }}>
          {title}
        </Typography>
        {hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{hint}</Typography>}
      </Box>
      <Grid container spacing={2}>{children}</Grid>
    </Box>
  );
}
