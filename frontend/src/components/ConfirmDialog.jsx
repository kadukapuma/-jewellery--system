import { useEffect, useState } from 'react';
import {
  Button, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField,
} from '@mui/material';
import Dialog from './Dialog';

// reasonLabel: also asks for a reason and passes it to onConfirm(reason) - used when the change goes to Admin.
export default function ConfirmDialog({ open, title, message, confirmText = 'Yes', color = 'primary', busy, reasonLabel, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
        {reasonLabel && (
          <TextField label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2}
            inputProps={{ maxLength: 255 }} sx={{ mt: 2 }} autoFocus />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={color} onClick={() => onConfirm(reason)} disabled={busy}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
