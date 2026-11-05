import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, Grid, InputAdornment, LinearProgress, Link, MenuItem, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import { formatAmount, formatDateTime } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { MOVEMENT_TYPES, movementLabel, movementLink } from '../../utils/stock';
import StockDialog from './StockDialog';

// Every stock change in the shop: purchases, sales, craft jobs and stock added / taken out by hand.
export default function StockMovementsPage() {
  const notify = useNotify();
  const [filters, setFilters] = useState({ search: '', movement_type: 'all', direction: 'all', from: '', to: '' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState({ total: 0, sums: null, movements: [] });
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(null); // item whose Stock window is open

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const res = await api.get('/items/stock-movements', { params });
      setData(res.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  const runSearch = () => {
    setPage(0);
    setFilters((f) => ({ ...f, search: searchText.trim() }));
  };
  const setFilter = (key) => (e) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  };

  const s = data.sums;

  return (
    <>
      <PageHeader title="Stock history" subtitle="Every piece that came into or went out of stock, and why" />

      {s && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="gold" label="Pieces in" note={`${formatWeight(s.weight_in)} gold`} value={formatAmount(s.qty_in)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="light" label="Pieces out" note={`${formatWeight(s.weight_out)} gold`} value={formatAmount(s.qty_out)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="gray" label="Movements" note="Matching the filters" value={formatAmount(data.total)} />
          </Grid>
        </Grid>
      )}

      <Card>
        <Box sx={{ display: 'flex', gap: 1.5, p: 2, flexWrap: 'wrap' }}>
          <TextField
            placeholder="Scan barcode or search code / name"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            onBlur={runSearch}
            sx={{ flex: '1 1 240px', maxWidth: 340 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          />
          <TextField select label="Type" value={filters.movement_type} onChange={setFilter('movement_type')} sx={{ width: 170 }}>
            <MenuItem value="all">All</MenuItem>
            {Object.entries(MOVEMENT_TYPES).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
          </TextField>
          <TextField select label="In / out" value={filters.direction} onChange={setFilter('direction')} sx={{ width: 120 }}>
            <MenuItem value="all">Both</MenuItem>
            <MenuItem value="in">In</MenuItem>
            <MenuItem value="out">Out</MenuItem>
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={setFilter('from')} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
          <TextField label="To" type="date" value={filters.to} onChange={setFilter('to')} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>What</TableCell>
                <TableCell align="right">Change</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.movements.map((m) => {
                const link = movementLink(m);
                return (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.created_at)}</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Link component="button" variant="body2" sx={{ fontWeight: 600 }} onClick={() => setOpened({ id: m.item_id, item_code: m.item_code, name: m.item_name, karat_name: m.karat_name })}>
                        {m.item_code}
                      </Link>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{m.item_name} · {m.karat_name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{movementLabel(m)}</Typography>
                      {m.ref_no && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {link ? <Link component={RouterLink} to={link}>{m.ref_no}</Link> : m.ref_no}
                        </Typography>
                      )}
                      {m.note && <Typography variant="caption" color="text.secondary">{m.note}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: m.qty_change > 0 ? 'success.main' : 'error.main' }}>
                      {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(Math.abs(Number(m.weight_change_g)))}</TableCell>
                    <TableCell>{m.created_by_name}</TableCell>
                  </TableRow>
                );
              })}
              {!loading && !data.movements.length && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>No stock changes match these filters</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={data.total}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[50, 100, 200]}
          onPageChange={(e, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        />
      </Card>

      {opened && <StockDialog item={opened} onClose={() => setOpened(null)} onChanged={load} />}
    </>
  );
}
