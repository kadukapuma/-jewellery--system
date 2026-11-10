import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, IconButton, InputAdornment, LinearProgress, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Tabs, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { CancelOldGoldDialog, OldGoldDialog } from './OldGoldDialog';

export const OLD_GOLD_MODES = {
  cash: { label: 'Bought for cash', color: 'warning' },
  credit: { label: 'Credit / advance', color: 'info' },
  exchange: { label: 'Exchanged on bill', color: 'success' },
};

// Has the value been used? (credit / exchange go onto bills; cash was paid out)
export const OLD_GOLD_USAGE = {
  unused: { label: 'Not used yet', color: 'info' },
  partly_used: { label: 'Partly used', color: 'warning' },
  used: { label: 'Used', color: 'success' },
  paid_out: { label: 'Paid out', color: 'default' },
};

// Chip + one line of detail: what is left, and on which bills it was used.
export function UsageStatus({ r }) {
  if (r.status === 'cancelled') return <Chip size="small" variant="outlined" label="Cancelled" />;
  const u = OLD_GOLD_USAGE[r.usage];
  return (
    <>
      <Chip size="small" label={u.label} color={u.color} variant={r.usage === 'used' ? 'filled' : 'outlined'} />
      {r.usage !== 'paid_out' && r.available_amount > 0 && (
        <Typography variant="caption" color="info.main" sx={{ display: 'block' }}>{formatMoney(r.available_amount)} left as advance</Typography>
      )}
      {r.used_on && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>On {r.used_on}</Typography>}
    </>
  );
}

const TABS = [['all', 'All'], ['exchange', 'Exchanged'], ['credit', 'Credit'], ['cash', 'Bought for cash'], ['cancelled', 'Cancelled']];

export default function OldGoldPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, sums: { value: 0, weight_g: 0 }, receipts: [] });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, status: tab === 'cancelled' ? 'cancelled' : 'active', mode: tab === 'cancelled' ? 'all' : tab };
      if (search) params.search = search;
      const res = await api.get('/old-gold', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, search, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        title="Old gold"
        subtitle="Customers' old gold bought for cash, kept as credit, or exchanged on a new bill"
        actions={can('old_gold.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ type: 'new' })}>Take in old gold</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs value={tab} onChange={(e, v) => { setTab(v); setPage(0); }} variant="scrollable">
            {TABS.map(([v, l]) => <Tab key={v} value={v} label={l} />)}
          </Tabs>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {data.total} receipts · {formatWeight(data.sums.weight_g)} · {formatMoney(data.sums.value)}
          </Typography>
          <TextField placeholder="Receipt, bill, customer or phone" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setSearch(searchText.trim()), setPage(0))} onBlur={() => { setSearch(searchText.trim()); setPage(0); }}
            sx={{ width: { xs: '100%', sm: 280 } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Receipt</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Given as</TableCell>
                <TableCell align="right">Pieces</TableCell>
                <TableCell align="right">Net gold</TableCell>
                <TableCell align="right">Value</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.receipts.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer', opacity: r.status === 'cancelled' ? 0.6 : 1 }} onClick={() => navigate(`/old-gold/${r.id}`)}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.receipt_no}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatDate(r.receipt_date)}</Typography>
                  </TableCell>
                  <TableCell>
                    {r.customer_name || 'Walk-in'}
                    {r.customer_phone && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.customer_phone}</Typography>}
                  </TableCell>
                  <TableCell>{OLD_GOLD_MODES[r.mode].label}</TableCell>
                  <TableCell align="right">{r.pieces}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(r.total_net_weight_g)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatMoney(r.total_value)}</TableCell>
                  <TableCell sx={{ minWidth: 150 }}><UsageStatus r={r} /></TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Print receipt"><IconButton size="small" onClick={() => navigate(`/old-gold/${r.id}`)}><PrintIcon fontSize="small" /></IconButton></Tooltip>
                    {r.status === 'active' && can('old_gold.cancel') && (
                      <Tooltip title="Cancel (give the gold back)"><IconButton size="small" onClick={() => setDialog({ type: 'cancel', receipt: r })}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.receipts.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No old gold here</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {dialog?.type === 'new' && (
        <OldGoldDialog onClose={() => setDialog(null)} onSaved={(r) => { setDialog(null); navigate(`/old-gold/${r.id}`); }} />
      )}
      {dialog?.type === 'cancel' && (
        <CancelOldGoldDialog receipt={dialog.receipt} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />
      )}
    </>
  );
}
