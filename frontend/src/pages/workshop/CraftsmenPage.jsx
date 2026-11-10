import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Chip, Grid, IconButton, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import AccountIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import DeleteButton from '../../components/DeleteButton';
import api, { APPROVAL_MESSAGE, errorMessage, isPendingApproval, withReason } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatAmount, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { heldByKaratText } from './heldGold';
import CraftsmanFormDialog from './CraftsmanFormDialog';
import CraftsmanAccountDialog from './CraftsmanAccountDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';

export default function CraftsmenPage() {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [craftsmen, setCraftsmen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {} = new
  const [accountFor, setAccountFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/craftsmen');
      setCraftsmen(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const goldOut = craftsmen.reduce((s, c) => s + c.gold_held_g, 0);
  const feesOwed = craftsmen.reduce((s, c) => s + Math.max(0, c.cash_due), 0);
  const openJobs = craftsmen.reduce((s, c) => s + c.open_jobs, 0);

  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(`/craftsmen/${deleting.id}`, withReason(reason));
      if (isPendingApproval(res)) notify(APPROVAL_MESSAGE, 'info');
      else notify(`${deleting.name} deleted`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  const { pageRows, pager } = usePagedRows(craftsmen);

  return (
    <>
      <PageHeader
        title="Craftsmen"
        subtitle="Who makes your jewellery, how much of your gold they hold, and what you owe them"
        actions={can('craftsmen.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add craftsman</Button>}
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gold" label="Gold with craftsmen" note="Your gold they still hold" value={formatAmount(Math.round(goldOut * 1000) / 1000)} unit="g" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="light" label="Jobs in progress" note="Gold given, piece not back yet" value={openJobs} to={can('craft_jobs.view') ? '/craft-jobs' : undefined} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gray" label="Fees owed" note="To all craftsmen" value={formatAmount(Math.round(feesOwed))} />
        </Grid>
      </Grid>

      <Card>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Craftsman</TableCell>
                <TableCell align="right">Jobs open</TableCell>
                <TableCell align="right">Gold held</TableCell>
                <TableCell align="right">Avg. wastage</TableCell>
                <TableCell align="right">Fees owed</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.phone}</Typography>
                  </TableCell>
                  <TableCell align="right">{c.open_jobs}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: c.gold_held_g ? 600 : 400 }}>
                    {formatWeight(c.gold_held_g)}
                    {c.gold_by_karat?.length > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 400 }}>
                        {heldByKaratText(c.gold_by_karat)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{c.wastage_percent === null ? '—' : `${c.wastage_percent}%`}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {c.cash_due < 0 ? `${formatMoney(-c.cash_due)} adv.` : formatMoney(c.cash_due)}
                  </TableCell>
                  <TableCell>{c.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Disabled" />}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {can('craftsman_account.view') && (
                      <Tooltip title="Gold & fees account"><IconButton size="small" onClick={() => setAccountFor(c)}><AccountIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('craftsmen.edit') && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('craftsmen.delete') && (
                      <DeleteButton onClick={() => setDeleting(c)}
                        blockedReason={c.job_count || c.payment_count || c.ledger_count ? 'this craftsman has jobs, payments or gold entries. Mark them Inactive instead.' : null} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !craftsmen.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>No craftsmen yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </TableContainer>
      </Card>

      {editing && <CraftsmanFormDialog craftsman={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {accountFor && <CraftsmanAccountDialog craftsmanId={accountFor.id} onClose={() => setAccountFor(null)} onChanged={load} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete craftsman"
        message={`Delete ${deleting?.name}? Admin can restore it from the Recycle Bin.`}
        confirmText={user.needs_approval ? 'Request delete' : 'Delete'}
        color="error"
        busy={busy}
        reasonLabel={user.needs_approval ? 'Reason (for Admin)' : undefined}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
