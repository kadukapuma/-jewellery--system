import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress,
  MenuItem, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import ConfirmDialog from '../../components/ConfirmDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';
import { formatDateTime } from '../../utils/format';
import {
  LOG_ACTIONS, REQUEST_STATUS, diffRows, requestTitle, showValue, tableLabel,
} from '../../utils/changes';

function DiffTable({ before, after }) {
  const rows = diffRows(before, after);
  if (!rows.length) return <Typography variant="body2" color="text.secondary">No details</Typography>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Field</TableCell>
          <TableCell>{after ? 'Now' : 'Value'}</TableCell>
          {after && <TableCell>Asked for</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.field} sx={r.changed ? { bgcolor: 'rgba(255, 167, 38, 0.12)', '& td': { fontWeight: 600 } } : undefined}>
            <TableCell sx={{ textTransform: 'capitalize', color: 'text.secondary' }}>{r.field}</TableCell>
            <TableCell sx={{ wordBreak: 'break-word' }}>{showValue(r.before)}</TableCell>
            {after && <TableCell sx={{ wordBreak: 'break-word', color: r.changed ? 'warning.dark' : undefined }}>{showValue(r.after)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReviewDialog({ request, onClose, onDone }) {
  const notify = useNotify();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = request.status === 'pending';

  const answer = async (verb) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/danger-zone/requests/${request.id}/${verb}`, verb === 'reject' ? { note } : undefined);
      notify(verb === 'approve' ? 'Change applied' : 'Request rejected');
      onDone();
    } catch (err) {
      // 409: already answered, or the change could not be applied (marked failed) - show why and refresh the list.
      if (err.response?.status === 409) {
        notify(errorMessage(err), 'error');
        onDone();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{requestTitle(request)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" sx={{ mb: 1 }}>
          Asked by <b>{request.requested_by_name}</b> on {formatDateTime(request.requested_at)}
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>Reason: {request.reason || <i>none given</i>}</Typography>
        {pending && request.is_stale && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This record was changed (or removed) after the request was made. Check it before approving.
          </Alert>
        )}
        {!pending && (
          <Alert severity={request.status === 'approved' ? 'success' : request.status === 'failed' ? 'error' : 'info'} sx={{ mb: 2 }}>
            {REQUEST_STATUS[request.status].label} by {request.reviewed_by_name} on {formatDateTime(request.reviewed_at)}
            {request.review_note ? ` – ${request.review_note}` : ''}
          </Alert>
        )}
        {request.action === 'delete' && pending && (
          <Alert severity="info" sx={{ mb: 2 }}>If approved, the record goes to the Recycle Bin and can be restored.</Alert>
        )}
        <DiffTable before={request.old_values} after={request.action === 'update' ? request.payload : null} />
        {pending && (
          <TextField label="Note to the user (when rejecting)" value={note} onChange={(e) => setNote(e.target.value)}
            fullWidth sx={{ mt: 2 }} inputProps={{ maxLength: 255 }} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {pending && (
          <>
            <Button color="error" onClick={() => answer('reject')} disabled={busy}>Reject</Button>
            <Button variant="contained" onClick={() => answer('approve')} disabled={busy}>Approve</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function RequestsTab({ onCount }) {
  const notify = useNotify();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/danger-zone/requests', { params: { status } });
      setRows(res.data);
      if (status === 'pending') onCount(res.data.length);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, notify, onCount]);
  useEffect(() => { load(); }, [load]);

  const { pageRows, pager } = usePagedRows(rows);

  return (
    <>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField select label="Show" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ width: 180 }}>
          <MenuItem value="pending">Waiting for me</MenuItem>
          <MenuItem value="all">All requests</MenuItem>
        </TextField>
        <Typography variant="body2" color="text.secondary">Edits and deletes other users asked for. Nothing changes until you approve.</Typography>
      </Box>
      {loading && <LinearProgress />}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Asked on</TableCell>
              <TableCell>By</TableCell>
              <TableCell>Change</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((r) => (
              <TableRow key={r.id} hover onClick={() => setOpen(r)} sx={{ cursor: 'pointer' }}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.requested_at)}</TableCell>
                <TableCell>{r.requested_by_name}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>
                  {requestTitle(r)}
                  {r.is_stale && <Chip size="small" color="warning" variant="outlined" label="Changed since" sx={{ ml: 1 }} />}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{r.reason || '—'}</TableCell>
                <TableCell><Chip size="small" variant="outlined" {...REQUEST_STATUS[r.status]} /></TableCell>
              </TableRow>
            ))}
            {!loading && !rows.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>No requests</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <TablePager {...pager} />
      </TableContainer>
      {open && <ReviewDialog request={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} />}
    </>
  );
}

function RecycleBinTab() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.get('/danger-zone/recycle-bin')).data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const restore = async () => {
    setBusy(true);
    try {
      await api.post(`/danger-zone/recycle-bin/${restoring.id}/restore`);
      notify(`${tableLabel(restoring.table_name)} ${restoring.record_label || ''} restored`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRestoring(null);
      setBusy(false);
    }
  };

  const { pageRows, pager } = usePagedRows(rows);
  const name = (b) => `${tableLabel(b.table_name)} ${b.record_label || `#${b.record_id}`}`;

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        Everything deleted is kept here with all its details. Restore brings it back exactly as it was, with the same number.
      </Typography>
      {loading && <LinearProgress />}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Deleted on</TableCell>
              <TableCell>By</TableCell>
              <TableCell>Record</TableCell>
              <TableCell>Kept</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((b) => (
              <TableRow key={b.id} hover sx={{ opacity: b.restored_at ? 0.6 : 1 }}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(b.deleted_at)}</TableCell>
                <TableCell>{b.deleted_by_name}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{name(b)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {b.data.map((p) => `${p.rows.length} ${tableLabel(p.table).toLowerCase()} row(s)`).join(', ')}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Button size="small" onClick={() => setViewing(b)}>View</Button>
                  {b.restored_at ? (
                    <Chip size="small" color="success" variant="outlined" label={`Restored by ${b.restored_by_name}`} />
                  ) : (
                    <Button size="small" variant="outlined" onClick={() => setRestoring(b)}>Restore</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && !rows.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>The recycle bin is empty</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <TablePager {...pager} />
      </TableContainer>

      {viewing && (
        <Dialog open onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
          <DialogTitle>{name(viewing)}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Deleted by {viewing.deleted_by_name} on {formatDateTime(viewing.deleted_at)}
              {viewing.change_request_id ? ` (approved request #${viewing.change_request_id})` : ''}
            </Typography>
            <DiffTable before={viewing.data[0]?.rows[0]} />
            {viewing.data.slice(1).map((p) => (
              <Typography key={p.table} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Also kept: {p.rows.length} {tableLabel(p.table).toLowerCase()} row(s)
              </Typography>
            ))}
          </DialogContent>
          <DialogActions><Button onClick={() => setViewing(null)}>Close</Button></DialogActions>
        </Dialog>
      )}
      <ConfirmDialog
        open={!!restoring}
        title="Restore"
        message={restoring ? `Bring back ${name(restoring)} exactly as it was when deleted?` : ''}
        confirmText="Restore"
        busy={busy}
        onConfirm={restore}
        onClose={() => setRestoring(null)}
      />
    </>
  );
}

function LogTab() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get('/danger-zone/logs')
      .then((res) => setRows(res.data))
      .catch((err) => notify(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  const { pageRows, pager } = usePagedRows(rows);

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        Every edit, delete, cancel, restore and request – who did it, when and from which computer. Click a row for the details.
      </Typography>
      {loading && <LinearProgress />}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>User</TableCell>
              <TableCell>What</TableCell>
              <TableCell>Record</TableCell>
              <TableCell>IP address</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((l) => (
              <TableRow key={l.id} hover onClick={() => setOpen(l)} sx={{ cursor: 'pointer' }}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.created_at)}</TableCell>
                <TableCell>{l.user_name}</TableCell>
                <TableCell><Chip size="small" variant="outlined" {...(LOG_ACTIONS[l.action] || { label: l.action })} /></TableCell>
                <TableCell>{tableLabel(l.table_name)}{l.record_id ? ` #${l.record_id}` : ''}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{l.ip_address}</TableCell>
              </TableRow>
            ))}
            {!loading && !rows.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>Nothing yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <TablePager {...pager} />
      </TableContainer>
      {open && (
        <Dialog open onClose={() => setOpen(null)} maxWidth="sm" fullWidth>
          <DialogTitle>
            {(LOG_ACTIONS[open.action] || { label: open.action }).label} – {tableLabel(open.table_name)}{open.record_id ? ` #${open.record_id}` : ''}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>{open.user_name} · {formatDateTime(open.created_at)} · {open.ip_address}</Typography>
            {open.old_values && open.new_values && !Array.isArray(open.new_values) && typeof open.old_values === 'object'
              ? <DiffTable before={open.old_values} after={open.new_values} />
              : <DiffTable before={open.new_values || open.old_values} />}
          </DialogContent>
          <DialogActions><Button onClick={() => setOpen(null)}>Close</Button></DialogActions>
        </Dialog>
      )}
    </>
  );
}

export default function DangerZonePage() {
  const notify = useNotify();
  const [tab, setTab] = useState('requests');
  const [pendingCount, setPendingCount] = useState(0);
  const [locked, setLocked] = useState(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  useEffect(() => {
    api.get('/danger-zone/settings').then((res) => setLocked(res.data.admin_only_changes)).catch((err) => notify(errorMessage(err), 'error'));
    api.get('/danger-zone/requests').then((res) => setPendingCount(res.data.length)).catch(() => {});
  }, [notify]);

  const saveLock = async (on) => {
    try {
      const res = await api.put('/danger-zone/settings', { admin_only_changes: on });
      setLocked(res.data.admin_only_changes);
      notify(on ? 'Only Admin can edit or delete now' : 'Users with permission can edit and delete directly now', on ? 'success' : 'warning');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setConfirmUnlock(false);
  };

  return (
    <>
      <PageHeader title="Danger Zone" subtitle="Who may change or delete records, requests waiting for you, deleted records and the change log" />

      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'error.light', p: 2.5, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <WarningIcon color="error" sx={{ mt: 0.5 }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>Only Admin can edit or delete</Typography>
          <Typography variant="body2" color="text.secondary">
            When on, other users&apos; edits and deletes are sent here as requests and nothing changes until you approve.
            Deleted records always go to the Recycle Bin. Bills, receipts and payments can only be deleted after they are cancelled.
          </Typography>
        </Box>
        {locked !== null && (
          <FormControlLabel
            control={<Switch color="error" checked={locked} onChange={(e) => (e.target.checked ? saveLock(true) : setConfirmUnlock(true))} />}
            label={locked ? 'On' : 'Off'}
          />
        )}
      </Card>

      <Card>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ px: 2, pt: 1 }}>
          <Tab value="requests" label={<Badge color="error" badgeContent={pendingCount} sx={{ pr: pendingCount ? 1.5 : 0 }}>Requests</Badge>} />
          <Tab value="bin" label="Recycle Bin" />
          <Tab value="log" label="Danger log" />
        </Tabs>
        {tab === 'requests' && <RequestsTab onCount={setPendingCount} />}
        {tab === 'bin' && <RecycleBinTab />}
        {tab === 'log' && <LogTab />}
      </Card>

      <ConfirmDialog
        open={confirmUnlock}
        title="Turn off the Admin lock?"
        message="Users whose role allows it will edit and delete without asking you. Deleted records still go to the Recycle Bin."
        confirmText="Turn off"
        color="error"
        onConfirm={() => saveLock(false)}
        onClose={() => setConfirmUnlock(false)}
      />
    </>
  );
}
