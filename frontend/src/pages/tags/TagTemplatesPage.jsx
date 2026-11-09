import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Chip, Grid, IconButton, LinearProgress, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import SectionCard from '../../components/SectionCard';
import { stone } from '../../theme';
import TagLabel, { FIELD_LABELS, SAMPLE_ITEM } from './TagLabel';
import TagTemplateDialog from './TagTemplateDialog';

const PREVIEW_SCALE = 2.4;

export default function TagTemplatesPage() {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // {} = new
  const [shopName, setShopName] = useState('');
  const [savingShop, setSavingShop] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/tags/templates');
      setData(res.data);
      setShopName(res.data.shop_name);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const saveShopName = async () => {
    setSavingShop(true);
    try {
      await api.put('/settings/shop_name', { value: shopName });
      notify('Shop name saved');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSavingShop(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Tag templates"
        subtitle="Label sizes and what each barcode tag shows"
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add template</Button>}
      />
      {!data && <LinearProgress />}

      {data && user.is_super_admin && (
        <SectionCard icon={<StorefrontIcon fontSize="small" />} title="Shop name on tags" sx={{ mb: 3, maxWidth: 560 }}>
          <Stack direction="row" spacing={1.5}>
            <TextField label="Shop name" value={shopName} onChange={(e) => setShopName(e.target.value)} />
            <Button variant="contained" onClick={saveShopName} disabled={savingShop || !shopName.trim() || shopName === data.shop_name}>Save</Button>
          </Stack>
        </SectionCard>
      )}

      {data && (
        <Grid container spacing={2.5}>
          {data.templates.map((t) => (
            <Grid key={t.id} size={{ xs: 12, lg: 6 }}>
              <Box sx={{ border: `1px solid ${stone[100]}`, borderRadius: '28px', p: 2.5, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>
                    {t.name} <Typography component="span" color="text.secondary">· {t.width_mm} × {t.height_mm} mm · {t.barcode_type}</Typography>
                  </Typography>
                  {t.is_default && <Chip size="small" color="primary" label="Default" />}
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                </Box>
                <Box sx={{ bgcolor: stone[50], borderRadius: '20px', p: 2, overflow: 'auto', display: 'grid', placeItems: 'center' }}>
                  <Box sx={{ width: `${t.width_mm * PREVIEW_SCALE}mm`, height: `${t.height_mm * PREVIEW_SCALE}mm`, maxWidth: '100%' }}>
                    <Box sx={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', width: 'fit-content', boxShadow: '0 1px 4px rgba(0,0,0,.25)' }}>
                      <TagLabel template={t} item={SAMPLE_ITEM} shopName={data.shop_name} />
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 2 }}>
                  {t.fields.map((f) => <Chip key={f} size="small" variant="outlined" label={FIELD_LABELS[f]} />)}
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}

      {editing && data && (
        <TagTemplateDialog
          template={editing.id ? editing : null}
          allFields={data.fields}
          shopName={data.shop_name}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}
