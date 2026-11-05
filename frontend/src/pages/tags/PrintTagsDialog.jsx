import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { stone } from '../../theme';
import TagLabel from './TagLabel';
import PrintArea from './PrintArea';

const PREVIEW_SCALE = 3.2; // the preview is shown larger than the real tag

export default function PrintTagsDialog({ items, onClose, onPrinted }) {
  const notify = useNotify();
  const [templates, setTemplates] = useState([]);
  const [shopName, setShopName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [copies, setCopies] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/tags/templates')
      .then((res) => {
        setTemplates(res.data.templates);
        setShopName(res.data.shop_name);
        setTemplateId((res.data.templates.find((t) => t.is_default) || res.data.templates[0])?.id ?? '');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const template = templates.find((t) => t.id === templateId);

  const print = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/tags/print', { item_ids: items.map((i) => i.id), template_id: templateId, copies: Number(copies) || 1 });
      setJob(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const done = useCallback(() => {
    setJob(null);
    setBusy(false);
    notify(`${items.length * (Number(copies) || 1)} tag(s) sent to the printer`);
    onPrinted();
    onClose();
  }, [items.length, copies, notify, onPrinted, onClose]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Print tags</DialogTitle>
      <DialogContent>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!loading && !templates.length && <Alert severity="warning">No tag templates. Add one under Tag Templates.</Alert>}
        {template && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField select label="Tag size" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name} · {t.width_mm}×{t.height_mm} mm{t.is_default ? ' (default)' : ''}</MenuItem>
                ))}
              </TextField>
              <TextField label="Copies each" type="number" value={copies} onChange={(e) => setCopies(e.target.value)}
                slotProps={{ htmlInput: { min: 1, max: 50 } }} sx={{ width: 140 }} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {items.length === 1 ? `${items[0].item_code} – ${items[0].name}` : `${items.length} items`} · preview of the first tag (enlarged)
            </Typography>
            <Box sx={{ bgcolor: stone[50], borderRadius: '20px', p: 3, display: 'grid', placeItems: 'center', overflow: 'auto' }}>
              <Box sx={{ width: `${template.width_mm * PREVIEW_SCALE}mm`, height: `${template.height_mm * PREVIEW_SCALE}mm`, maxWidth: '100%' }}>
                <Box sx={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', boxShadow: '0 1px 4px rgba(0,0,0,.25)', width: 'fit-content' }}>
                  <TagLabel template={template} item={items[0]} shopName={shopName} />
                </Box>
              </Box>
            </Box>
            <Alert severity="info" variant="outlined">
              In the print window, choose your label printer and set margins to <b>None</b>. Each tag prints on its own label.
            </Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={print} disabled={!template || busy}>
          Print {items.length * (Number(copies) || 1)} tag(s)
        </Button>
      </DialogActions>
      {job && <PrintArea job={job} onDone={done} />}
    </Dialog>
  );
}
