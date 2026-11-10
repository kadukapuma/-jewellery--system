import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, IconButton, InputAdornment, LinearProgress, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Tabs, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/HandymanOutlined';
import DoneIcon from '@mui/icons-material/TaskAltOutlined';
import HandOverIcon from '@mui/icons-material/StorefrontOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { todayYmd } from '../../utils/payments';
import {
  CancelRepairDialog, DeliverRepairDialog, GiveRepairDialog, ReceiveRepairDialog, RepairBackDialog, RepairPaymentDialog,
} from './RepairDialogs';

export const REPAIR_STATUS = {
  received: { label: 'In shop', color: 'info' },
  with_craftsman: { label: 'With craftsman', color: 'warning' },
  ready: { label: 'Ready to collect', color: 'success' },
  delivered: { label: 'Collected', color: 'default' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

const TABS = [
  ['open', 'Open'], ['received', 'In shop'], ['with_craftsman', 'With craftsman'], ['ready', 'Ready'],
  ['delivered', 'Collected'], ['cancelled', 'Cancelled'], ['all', 'All'],
];

export default function RepairsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: 'open', search: '' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, counts: {}, repairs: [] });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { type, repair }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      if (!params.search) delete params.search;
      const res = await api.get('/repairs', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key, value) => { setPage(0); setFilters((f) => ({ ...f, [key]: value })); };
  const close = () => setDialog(null);
  const done = () => { setDialog(null); load(); };
  const open = (type, repair) => setDialog({ type, repair });
  const openCount = (data.counts.received || 0) + (data.counts.with_craftsman || 0) + (data.counts.ready || 0);
  const today = todayYmd();

  return (
    <>
      <PageHeader
        title="Customer repairs"
        subtitle="Customers' own items taken in, sent to a craftsman and handed back"
        actions={can('repairs.create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => open('receive')}>Take in repair</Button>}
      />
      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs value={filters.status} onChange={(e, v) => setFilter('status', v)} variant="scrollable">
            {TABS.map(([v, l]) => {
              const n = v === 'open' ? openCount : data.counts[v];
              return <Tab key={v} value={v} label={n && v !== 'all' && v !== 'delivered' && v !== 'cancelled' ? `${l} (${n})` : l} />;
            })}
          </Tabs>
          <Box sx={{ flexGrow: 1 }} />
          <TextField placeholder="Repair no., item, customer or phone" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setFilter('search', searchText.trim())} onBlur={() => setFilter('search', searchText.trim())}
            sx={{ width: 280 }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Repair</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Item & work</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell>Craftsman</TableCell>
                <TableCell align="right">Charge</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.repairs.map((r) => {
                const late = r.promised_date && ['received', 'with_craftsman'].includes(r.status) && String(r.promised_date).slice(0, 10) < today;
                return (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.repair_no}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDate(r.received_date)}</Typography>
                    </TableCell>
                    <TableCell>
                      {r.customer_name}
                      {r.customer_phone && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.customer_phone}</Typography>}
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      {r.item_description}
                      {r.work_to_do && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.work_to_do}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {formatWeight(r.weight_in_g)}
                      {Number(r.extra_gold_g) > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>+ {formatWeight(r.extra_gold_g)} shop gold</Typography>}
                      {r.weight_back_g !== null && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>back {formatWeight(r.weight_back_g)}</Typography>}
                    </TableCell>
                    <TableCell>{r.craftsman_name || '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'delivered' ? formatMoney(r.total_charge) : r.estimated_charge > 0 ? <>~{formatMoney(r.estimated_charge)}</> : '—'}
                      {r.paid_amount > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>paid {formatMoney(r.paid_amount)}</Typography>}
                      {r.balance_due > 0 && <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>due {formatMoney(r.balance_due)}</Typography>}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip size="small" variant="outlined" label={REPAIR_STATUS[r.status].label} color={REPAIR_STATUS[r.status].color} />
                      {r.promised_date && !['delivered', 'cancelled'].includes(r.status) && (
                        <Typography variant="caption" color={late ? 'error.main' : 'text.secondary'} sx={{ display: 'block' }}>
                          {late ? 'Late · ' : ''}by {formatDate(r.promised_date)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'received' && can('repairs.edit') && (
                        <Button size="small" variant="contained" startIcon={<SendIcon />} onClick={() => open('give', r)}>Give</Button>
                      )}
                      {r.status === 'with_craftsman' && can('repairs.edit') && (
                        <Button size="small" variant="contained" startIcon={<DoneIcon />} onClick={() => open('back', r)}>Back</Button>
                      )}
                      {r.status === 'ready' && can('repairs.deliver') && (
                        <Button size="small" variant="contained" startIcon={<HandOverIcon />} onClick={() => open('deliver', r)}>Hand over</Button>
                      )}
                      {r.status === 'delivered' && r.balance_due > 0 && can('repairs.deliver') && (
                        <Button size="small" variant="outlined" startIcon={<PaymentsIcon />} onClick={() => open('pay', r)}>Receive</Button>
                      )}
                      <Tooltip title="Print slip"><IconButton size="small" onClick={() => navigate(`/repairs/${r.id}`)}><PrintIcon fontSize="small" /></IconButton></Tooltip>
                      {['received', 'with_craftsman'].includes(r.status) && can('repairs.cancel') && (
                        <Tooltip title="Cancel repair"><IconButton size="small" onClick={() => open('cancel', r)}><CancelIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && !data.repairs.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No repairs here</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </Card>

      {dialog?.type === 'receive' && (
        <ReceiveRepairDialog onClose={close} onSaved={(r) => { setDialog(null); navigate(`/repairs/${r.id}`, { state: { justCreated: true } }); }} />
      )}
      {dialog?.type === 'give' && <GiveRepairDialog repair={dialog.repair} onClose={close} onSaved={done} />}
      {dialog?.type === 'back' && <RepairBackDialog repair={dialog.repair} onClose={close} onSaved={done} />}
      {dialog?.type === 'deliver' && <DeliverRepairDialog repair={dialog.repair} onClose={close} onSaved={done} />}
      {dialog?.type === 'pay' && <RepairPaymentDialog repair={dialog.repair} onClose={close} onSaved={done} />}
      {dialog?.type === 'cancel' && <CancelRepairDialog repair={dialog.repair} onClose={close} onDone={done} />}
    </>
  );
}
