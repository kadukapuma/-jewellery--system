import { Button, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';

// Delete action that is always visible. When the record cannot be deleted (it is used by bills,
// purchases, stock history ...) it is greyed out and hovering explains why and what to do instead.
//   blockedReason: null = can delete; otherwise the text shown on hover.
//   button: true = a text button (detail pages); default is an icon in a table row.
export default function DeleteButton({ blockedReason = null, onClick, label = 'Delete', button = false }) {
  const blocked = !!blockedReason;
  const control = button ? (
    <Button color="error" startIcon={<DeleteIcon />} onClick={onClick} disabled={blocked}>{label}</Button>
  ) : (
    <IconButton size="small" onClick={onClick} disabled={blocked} aria-label={label}><DeleteIcon fontSize="small" /></IconButton>
  );
  return (
    <Tooltip title={blocked ? `Cannot delete: ${blockedReason}` : label}>
      {/* A disabled button gets no mouse events, so the tooltip needs a wrapper. */}
      <span style={{ display: 'inline-flex' }}>{control}</span>
    </Tooltip>
  );
}
