import { useState } from 'react';
import {
  Alert, Button, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import api, { APPROVAL_MESSAGE, errorMessage, fieldErrors, isPendingApproval, withReason } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import Dialog from './Dialog';
import ConfirmDialog from './ConfirmDialog';
import { useNotify } from './Notify';

function EditFieldsDialog({ record, label, url, fields, onClose, onDone }) {
  const notify = useNotify();
  const { user } = useAuth();
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f.name, record[f.name] ?? ''])));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.patch(url, form);
      notify(isPendingApproval(res) ? APPROVAL_MESSAGE : `${label} saved`, isPendingApproval(res) ? 'info' : 'success');
      onDone();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit {label}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          Amounts and items cannot be changed. To fix those, cancel it and enter it again.
        </Alert>
        <Stack spacing={2}>
          {fields.map((f) => (
            <TextField key={f.name} label={f.label} type={f.type || 'text'} value={form[f.name] ?? ''}
              onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); setErrors((p) => ({ ...p, [f.name]: undefined })); }}
              multiline={f.name === 'notes'} minRows={f.name === 'notes' ? 2 : undefined}
              slotProps={f.type === 'date' ? { inputLabel: { shrink: true } } : undefined}
              error={!!errors[f.name]} helperText={errors[f.name]} />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>{user.needs_approval ? 'Send for approval' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// Edit (reference / notes only) and Delete (only once cancelled) for bills, receipts, payments, expenses...
// module: permission module, e.g. 'customer_payments'. fields: [{ name, label, type }] or none for no Edit.
// onDeleted runs instead of onDone once the record is really deleted (not just requested).
export default function RecordActions({ record, label, url, module, fields, onDone, onDeleted }) {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(url, withReason(reason));
      setDeleting(false);
      if (isPendingApproval(res)) {
        notify(APPROVAL_MESSAGE, 'info');
        onDone();
      } else {
        notify(`${label} deleted`);
        (onDeleted || onDone)();
      }
    } catch (err) {
      notify(errorMessage(err), 'error');
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  };

  const canEdit = fields?.length && can(`${module}.edit`);
  const canDelete = record.status === 'cancelled' && can(`${module}.delete`);
  if (!canEdit && !canDelete) return null;

  return (
    <>
      {canEdit && (
        <Tooltip title="Edit reference / notes">
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditing(true); }}><EditIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      {canDelete && (
        <Tooltip title="Delete (goes to the Recycle Bin)">
          <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); setDeleting(true); }}><DeleteIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      {editing && (
        <EditFieldsDialog record={record} label={label} url={url} fields={fields} onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); onDone(); }} />
      )}
      <ConfirmDialog
        open={deleting}
        title={`Delete ${label}`}
        message={`${label} is cancelled, so deleting it does not change any balance. Admin can restore it from the Recycle Bin.`}
        confirmText={user.needs_approval ? 'Request delete' : 'Delete'}
        color="error"
        busy={busy}
        reasonLabel={user.needs_approval ? 'Reason (for Admin)' : undefined}
        onConfirm={remove}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}
