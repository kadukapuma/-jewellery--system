import { useNavigate } from 'react-router-dom';
import { Box, IconButton, Typography } from '@mui/material';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import { ink, stone } from '../theme';

// Light card with a round icon, a title and a black arrow link (like "Sales by Product Category").
export default function SectionCard({ icon, title, to, children, sx }) {
  const navigate = useNavigate();
  return (
    <Box sx={{ bgcolor: stone[50], borderRadius: '28px', p: 1, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#fff', display: 'grid', placeItems: 'center', border: `1px solid ${stone[200]}` }}>
          {icon}
        </Box>
        <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        {to && (
          <IconButton
            aria-label={`Open ${title}`}
            onClick={() => navigate(to)}
            sx={{ bgcolor: ink, color: '#fff', width: 44, height: 44, '&:hover': { bgcolor: '#000' } }}
          >
            <NorthEastIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box sx={{ bgcolor: '#fff', borderRadius: '22px', p: 2, mt: 1 }}>{children}</Box>
    </Box>
  );
}
