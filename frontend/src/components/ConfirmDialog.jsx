import {
  Button, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';
import Dialog from './Dialog';

export default function ConfirmDialog({ open, title, message, confirmText = 'Yes', color = 'primary', busy, onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={color} onClick={onConfirm} disabled={busy}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
