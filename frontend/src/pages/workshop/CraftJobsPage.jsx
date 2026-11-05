import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Chip, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress,
  MenuItem, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, Tooltip,
  Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import DoneIcon from '@mui/icons-material/TaskAltOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import LabelIcon from '@mui/icons-material/LocalOfferOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDate } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import PrintTagsDialog from '../tags/PrintTagsDialog';
import IssueJobDialog from './IssueJobDialog';
import CompleteJobDialog from './CompleteJobDialog';

const STATUS = {
  issued: { label: 'With craftsman', color: 'warning' },
  completed: { label: 'Received', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

function CancelJobDialog({ job, onClose, onDone }) {
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/craft-jobs/${job.id}/cancel`, { reason });
      notify(`${job.job_no} cancelled – ${formatWeight(job.issued_weight_g)} back from ${job.craftsman_name}`);
      onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel {job.job_no}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use this when {job.craftsman_name} gives back all {formatWeight(job.issued_weight_g)} of gold.
          {job.source_item_code ? ` ${job.source_item_code} goes back into stock.` : ''}
          {job.job_type === 'rework' ? ` ${job.finished_item_code} goes back into stock as it was.` : ''}
          {job.job_type === 'make_item' ? ` ${job.finished_item_code} stays saved, ready for another job.` : ''}
        </Typography>
        <TextField label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep job</Button>
        <Button variant="contained" color="error" onClick={cancel} disabled={busy}>Cancel job</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CraftJobsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const [craftsmen, setCraftsmen] = useState([]);
  const [filters, setFilters] = useState({ status: 'issued', craftsman_id: '', search: '' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sums: null, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [printing, setPrinting] = useState(null);

  useEffect(() => {
    api.get('/craftsmen').then((res) => setCraftsmen(res.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/craft-jobs', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const printFinished = async (itemId) => {
    try {
      const res = await api.get(`/items/${itemId}`);
      setPrinting([res.data]);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const setFilter = (key, value) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  return (
    <>
      <PageHeader
        title="Craft jobs"
        subtitle="Gold given to craftsmen and the pieces they bring back"
        actions={can('craft_jobs.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setIssuing(true)}>Give work</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs value={filters.status} onChange={(e, v) => setFilter('status', v)} variant="scrollable">
            <Tab value="issued" label="With craftsman" />
            <Tab value="completed" label="Received" />
            <Tab value="cancelled" label="Cancelled" />
            <Tab value="all" label="All" />
          </Tabs>
          <Box sx={{ flexGrow: 1 }} />
          <TextField select label="Craftsman" value={filters.craftsman_id} onChange={(e) => setFilter('craftsman_id', e.target.value)} sx={{ width: 180 }}>
            <MenuItem value="">All</MenuItem>
            {craftsmen.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField placeholder="Job no. or description" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setFilter('search', searchText.trim())} onBlur={() => setFilter('search', searchText.trim())}
            sx={{ width: 220 }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Craftsman</TableCell>
                <TableCell>Making</TableCell>
                <TableCell align="right">Gold given</TableCell>
                <TableCell align="right">Finished</TableCell>
                <TableCell align="right">Wastage</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.jobs.map((j) => {
                const wastagePct = j.wastage_g !== null && Number(j.issued_weight_g) ? Math.round((j.wastage_g / j.issued_weight_g) * 10000) / 100 : null;
                return (
                  <TableRow key={j.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{j.job_no}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDate(j.issue_date)}</Typography>
                    </TableCell>
                    <TableCell>{j.craftsman_name}</TableCell>
                    <TableCell sx={{ minWidth: 120 }}>
                      {j.description || j.category_name}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {j.job_type === 'rework' ? `Repair · ${j.finished_item_code}` : j.job_type === 'make_item' ? `Make · ${j.finished_item_code}` : j.category_name}
                        {j.source_item_code ? ` · from ${j.source_item_code}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatWeight(j.issued_weight_g)}</Typography>
                      <Typography variant="caption" color="text.secondary">{j.karat_name}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {j.returned_weight_g !== null ? formatWeight(j.returned_weight_g) : '—'}
                      {j.finished_item_code && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{j.finished_item_code}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {j.wastage_g !== null ? `${formatWeight(j.wastage_g)}` : '—'}
                      {wastagePct !== null && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{wastagePct}%</Typography>}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip size="small" variant="outlined" label={STATUS[j.status].label} color={STATUS[j.status].color} />
                      {j.status === 'issued' && <Typography variant="caption" color={j.days_out > 14 ? 'error.main' : 'text.secondary'} sx={{ display: 'block' }}>{j.days_out} day(s) out</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {j.status === 'issued' && can('craft_jobs.complete') && (
                        <Button size="small" variant="contained" startIcon={<DoneIcon />} onClick={() => setCompleting(j)}>Receive</Button>
                      )}
                      {j.status === 'issued' && can('craft_jobs.delete') && (
                        <Tooltip title="Cancel job"><IconButton size="small" onClick={() => setCancelling(j)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      {j.status === 'completed' && j.item_id && can('tags.print') && (
                        <Tooltip title="Print tag"><IconButton size="small" onClick={() => printFinished(j.item_id)}><LabelIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && !data.jobs.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No jobs here</TableCell></TableRow>
              )}
              {data.sums && data.jobs.length > 0 && (
                <TableRow>
                  <TableCell colSpan={3} sx={{ fontWeight: 600 }}>Total ({data.total})</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeight(data.sums.issued_g)}</TableCell>
                  <TableCell />
                  <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{data.sums.wastage_g ? formatWeight(data.sums.wastage_g) : ''}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {issuing && <IssueJobDialog onClose={() => setIssuing(false)} onSaved={() => { setIssuing(false); setFilter('status', 'issued'); load(); }} />}
      {completing && (
        <CompleteJobDialog
          job={completing}
          onClose={() => setCompleting(null)}
          onSaved={(res, printNow) => { setCompleting(null); load(); if (printNow) printFinished(res.item_id); }}
        />
      )}
      {cancelling && <CancelJobDialog job={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); load(); }} />}
      {printing && <PrintTagsDialog items={printing} onClose={() => setPrinting(null)} onPrinted={() => {}} />}
    </>
  );
}
