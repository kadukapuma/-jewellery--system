import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Link, TextField, Typography,
} from '@mui/material';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import PersonIcon from '@mui/icons-material/PersonOutlined';
import ReceiptIcon from '@mui/icons-material/ReceiptLongOutlined';
import RequestQuoteIcon from '@mui/icons-material/RequestQuoteOutlined';
import EngineeringIcon from '@mui/icons-material/EngineeringOutlined';
import RecyclingIcon from '@mui/icons-material/Recycling';
import DiamondIcon from '@mui/icons-material/DiamondOutlined';
import LocalShippingIcon from '@mui/icons-material/LocalShippingOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import Dialog from './Dialog';
import api, { errorMessage } from '../api/client';
import { gold, stone } from '../theme';

// Everything a cancel changes besides the record itself, as sent by the server (utils/cancelEffects.js).
const AREAS = {
  stock: { label: 'Stock', icon: InventoryIcon },
  old_gold: { label: 'Old gold', icon: RecyclingIcon },
  gold: { label: 'Hand back', icon: DiamondIcon },
  receipt: { label: 'Receipts', icon: RequestQuoteIcon },
  bill: { label: 'Bills', icon: ReceiptIcon },
  customer: { label: 'Customer account', icon: PersonIcon },
  supplier: { label: 'Supplier account', icon: LocalShippingIcon },
  craftsman: { label: 'Craftsman', icon: EngineeringIcon },
  money: { label: 'Cash & bank', icon: PaymentsIcon },
};
const ORDER = Object.keys(AREAS);

export function CancelEffects({ effects, onNavigate }) {
  if (!effects?.length) {
    return <Typography variant="body2" color="text.secondary">Nothing else changes. Only this record is cancelled.</Typography>;
  }
  const groups = ORDER.map((area) => [area, effects.filter((e) => e.area === area)]).filter(([, list]) => list.length);
  return (
    <Box sx={{ border: `1px solid ${gold[200]}`, bgcolor: gold[50], borderRadius: '16px', p: 2 }}>
      {groups.map(([area, list], gi) => {
        const { label, icon: Icon } = AREAS[area];
        return (
          <Box key={area} sx={{ ...(gi > 0 && { mt: 1.5, pt: 1.5, borderTop: `1px dashed ${stone[200]}` }) }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Icon fontSize="small" sx={{ color: gold[700] }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: gold[800] }}>{label}</Typography>
            </Box>
            {list.map((e, i) => (
              <Typography key={i} variant="body2" sx={{ pl: 3.5, py: 0.25 }}>
                {e.text}
                {e.link && (
                  <> · <Link component={RouterLink} to={e.link} onClick={onNavigate} underline="hover">Open</Link></>
                )}
              </Typography>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

// Cancel window for any record. It first asks the server what the cancel would change (nothing is saved),
// shows that list, and after the real cancel shows what did change.
//   url: the cancel endpoint, e.g. /sales/12/cancel
//   onDone(result): called when the user closes the "done" view (result = the cancelled record from the server)
export default function CancelDialog({
  title, url, intro, reasonRequired = false, defaultReason = '', reasonPlaceholder,
  keepText = 'Keep it', confirmText = 'Cancel it', doneText = 'Close', onClose, onDone,
}) {
  const [reason, setReason] = useState(defaultReason);
  const [preview, setPreview] = useState(null); // effects list
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the server's answer after the real cancel

  useEffect(() => {
    let active = true;
    api.post(url, { preview: true })
      .then((r) => active && setPreview(r.data.effects || []))
      .catch((err) => {
        if (!active) return;
        // The server cannot show the list first (database without transactions): cancel still works,
        // and the list is shown afterwards.
        if (err.response?.data?.code === 'PREVIEW_UNAVAILABLE') setPreview('unavailable');
        else setPreviewError(errorMessage(err));
      });
    return () => { active = false; };
  }, [url]);

  const cancel = async () => {
    if (reasonRequired && !reason.trim()) { setError('Give a reason'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api.post(url, { reason: reason.trim() });
      setDone(r.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const close = () => onDone(done);
    return (
      <Dialog open onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon color="success" /> Cancelled: what changed
          </Box>
        </DialogTitle>
        <DialogContent>
          <CancelEffects effects={done.effects} onNavigate={close} />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={close}>{doneText}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {intro && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{intro}</Typography>}
        {previewError ? (
          <Alert severity="error" sx={{ mb: 2 }}>{previewError}</Alert>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Cancelling this will also change:</Typography>
            {preview === null && <LinearProgress />}
            {preview === 'unavailable' && (
              <Alert severity="warning">The list cannot be shown before cancelling. You will see everything that changed right after.</Alert>
            )}
            {Array.isArray(preview) && <CancelEffects effects={preview} onNavigate={onClose} />}
          </Box>
        )}
        {!previewError && (
          <TextField label="Reason" fullWidth required={reasonRequired} autoFocus value={reason} placeholder={reasonPlaceholder}
            onChange={(e) => { setReason(e.target.value); setError(''); }} slotProps={{ htmlInput: { maxLength: 255 } }} />
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{keepText}</Button>
        <Button variant="contained" color="error" onClick={cancel}
          disabled={busy || !!previewError || preview === null || (reasonRequired && !reason.trim())}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
