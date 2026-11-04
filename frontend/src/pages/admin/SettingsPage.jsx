import { useEffect, useState } from 'react';
import { Alert, Box, Button, Grid, LinearProgress, TextField, Typography } from '@mui/material';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import api, { errorMessage, fieldErrors } from '../../api/client';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import SectionCard from '../../components/SectionCard';

const KEYS = ['shop_name', 'shop_address', 'shop_phone', 'invoice_footer', 'max_failed_logins', 'lock_minutes'];

export default function SettingsPage() {
  const notify = useNotify();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then((res) => { setSaved(res.data); setForm(Object.fromEntries(KEYS.map((k) => [k, res.data[k] ?? '']))); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    const changed = KEYS.filter((k) => String(form[k]) !== String(saved[k] ?? ''));
    const problems = {};
    for (const key of changed) {
      try {
        await api.put(`/settings/${key}`, { value: form[key] });
      } catch (err) {
        problems[key] = fieldErrors(err)[''] || errorMessage(err);
      }
    }
    setErrors(problems);
    setBusy(false);
    if (Object.keys(problems).length) {
      setError('Some settings were not saved');
    } else {
      setSaved({ ...saved, ...form });
      notify(changed.length ? 'Settings saved' : 'Nothing changed');
    }
  };

  const field = (key, label, props = {}) => (
    <TextField label={label} value={form[key] ?? ''} onChange={set(key)} {...props} error={!!errors[key]} helperText={errors[key] || props.helperText} />
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Shop details for bills and tags, and login security"
        actions={<Button variant="contained" onClick={save} disabled={busy || !saved}>Save settings</Button>} />
      {!saved && !error && <LinearProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <SectionCard icon={<StorefrontIcon fontSize="small" />} title="Shop details">
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>{field('shop_name', 'Shop name', { required: true })}</Grid>
                <Grid size={{ xs: 12, sm: 6 }}>{field('shop_phone', 'Phone')}</Grid>
                <Grid size={{ xs: 12 }}>{field('shop_address', 'Address')}</Grid>
                <Grid size={{ xs: 12 }}>{field('invoice_footer', 'Bill footer', { helperText: 'Printed at the bottom of every bill' })}</Grid>
              </Grid>
            </SectionCard>
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <SectionCard icon={<LockIcon fontSize="small" />} title="Login security">
              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>{field('max_failed_logins', 'Wrong passwords allowed', { type: 'number', helperText: '3 – 20' })}</Grid>
                <Grid size={{ xs: 6 }}>{field('lock_minutes', 'Lock for (minutes)', { type: 'number', helperText: '1 – 1440' })}</Grid>
              </Grid>
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Gold is priced at {saved.grams_per_pound} grams per pound. This is fixed so old bills and prices stay correct.
                </Typography>
              </Box>
            </SectionCard>
          </Grid>
        </Grid>
      )}
    </>
  );
}
