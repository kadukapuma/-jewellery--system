import { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Grid,
  InputAdornment, MenuItem, Switch, TextField, Typography,
} from '@mui/material';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import { stone } from '../../theme';
import TagLabel, { FIELD_LABELS, SAMPLE_ITEM } from './TagLabel';

const PREVIEW_SCALE = 2.6;

export default function TagTemplateDialog({ template, allFields, shopName, onClose, onSaved }) {
  const isNew = !template;
  const notify = useNotify();
  const [form, setForm] = useState({
    name: template?.name || '',
    width_mm: template?.width_mm ?? 75,
    height_mm: template?.height_mm ?? 12,
    barcode_type: template?.barcode_type || 'CODE128',
    fields: template?.fields || ['shop_name', 'barcode', 'item_code', 'karat', 'net_weight_g'],
    is_default: template?.is_default ?? false,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const toggleField = (f) => {
    // keep the server's field order so the label layout is predictable
    const next = form.fields.includes(f) ? form.fields.filter((x) => x !== f) : allFields.filter((x) => x === f || form.fields.includes(x));
    setForm({ ...form, fields: next });
  };

  const w = Number(form.width_mm);
  const h = Number(form.height_mm);
  const sizeOk = w >= 10 && w <= 200 && h >= 5 && h <= 200;

  const save = async () => {
    setError('');
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!(w >= 10 && w <= 200)) e.width_mm = '10 – 200 mm';
    if (!(h >= 5 && h <= 200)) e.height_mm = '5 – 200 mm';
    if (!form.fields.length) e.fields = 'Pick at least one thing to print';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { ...form, width_mm: w, height_mm: h };
    try {
      if (isNew) await api.post('/tags/templates', body);
      else await api.put(`/tags/templates/${template.id}`, body);
      notify(isNew ? 'Template added' : 'Template saved');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const mm = { type: 'number', slotProps: { input: { endAdornment: <InputAdornment position="end">mm</InputAdornment> } } };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isNew ? 'Add tag template' : `Edit ${template.name}`}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Name" required value={form.name} onChange={set('name')} placeholder="Ring tag 75×12" error={!!errors.name} helperText={errors.name} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Width" {...mm} value={form.width_mm} onChange={set('width_mm')} error={!!errors.width_mm} helperText={errors.width_mm} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Height" {...mm} value={form.height_mm} onChange={set('height_mm')} error={!!errors.height_mm} helperText={errors.height_mm} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Barcode type" value={form.barcode_type} onChange={set('barcode_type')}
              helperText="CODE128 works with any barcode scanner; QR needs a 2D scanner">
              <MenuItem value="CODE128">CODE128 (lines)</MenuItem>
              <MenuItem value="QR">QR code</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControlLabel
              control={<Switch checked={form.is_default} disabled={template?.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />}
              label={template?.is_default ? 'Default template' : 'Use as default'}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Print on the tag</Typography>
            <FormGroup row>
              {allFields.map((f) => (
                <FormControlLabel key={f} label={FIELD_LABELS[f]}
                  control={<Checkbox size="small" checked={form.fields.includes(f)} onChange={() => toggleField(f)} />} />
              ))}
            </FormGroup>
            {errors.fields && <Typography variant="caption" color="error">{errors.fields}</Typography>}
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Preview (enlarged)</Typography>
            <Box sx={{ bgcolor: stone[50], borderRadius: '20px', p: 2, overflow: 'auto', display: 'grid', placeItems: 'center', minHeight: 80 }}>
              {sizeOk && form.fields.length > 0 ? (
                <Box sx={{ width: `${w * PREVIEW_SCALE}mm`, height: `${h * PREVIEW_SCALE}mm`, maxWidth: '100%' }}>
                  <Box sx={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', width: 'fit-content', boxShadow: '0 1px 4px rgba(0,0,0,.25)' }}>
                    <TagLabel template={{ ...form, width_mm: w, height_mm: h }} item={SAMPLE_ITEM} shopName={shopName} />
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">Enter a valid size and pick what to print</Typography>
              )}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
