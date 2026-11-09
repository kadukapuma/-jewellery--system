import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Checkbox, Chip, Grid, IconButton, InputAdornment, LinearProgress, MenuItem, Table, TableBody,
  TableCell, TableContainer, TableHead, TablePagination, TableRow, Tooltip, Typography,
} from '@mui/material';
import TextField from '../../components/TextField';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SearchIcon from '@mui/icons-material/Search';
import LabelIcon from '@mui/icons-material/LocalOfferOutlined';
import StockIcon from '@mui/icons-material/Inventory2Outlined';
import api, { APPROVAL_MESSAGE, errorMessage, isPendingApproval, withReason } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatAmount, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import ItemFormDialog from './ItemFormDialog';
import PriceRange from '../../components/PriceRange';
import PrintTagsDialog from '../tags/PrintTagsDialog';
import StockDialog from './StockDialog';

const STATUS = {
  in_stock: { label: 'In stock', color: 'success' },
  sold: { label: 'Sold', color: 'default' },
  with_craftsman: { label: 'With craftsman', color: 'warning' },
  inactive: { label: 'Inactive', color: 'default' },
};

export default function ItemsPage() {
  const { can, user } = useAuth();
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [karats, setKarats] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ search: '', category_id: '', karat_id: '', status: 'in_stock' });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Map()); // id -> item, kept across pages
  const [editing, setEditing] = useState(null); // {} = new
  const [deleting, setDeleting] = useState(null);
  const [printing, setPrinting] = useState(null); // items to print
  const [stockItem, setStockItem] = useState(null); // item whose Stock window is open
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/categories'), api.get('/karats')])
      .then(([c, k]) => { setCategories(c.data); setKarats(k.data); })
      .catch((err) => notify(errorMessage(err), 'error'));
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, page, page_size: pageSize };
      Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
      const [list, sum] = await Promise.all([api.get('/items', { params }), api.get('/items/summary')]);
      setData(list.data);
      setSummary(sum.data);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, notify]);

  useEffect(() => { load(); }, [load]);

  // Search runs on Enter, so a barcode scanner (types the code + Enter) finds the item at once.
  const runSearch = () => {
    setPage(0);
    setFilters((f) => ({ ...f, search: searchText.trim() }));
  };
  const setFilter = (key) => (e) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  };

  const toggle = (item) => {
    const next = new Map(selected);
    if (next.has(item.id)) next.delete(item.id);
    else next.set(item.id, item);
    setSelected(next);
  };
  const pageAllSelected = data.items.length > 0 && data.items.every((i) => selected.has(i.id));
  const togglePage = () => {
    const next = new Map(selected);
    data.items.forEach((i) => (pageAllSelected ? next.delete(i.id) : next.set(i.id, i)));
    setSelected(next);
  };

  const remove = async (reason) => {
    setBusy(true);
    try {
      const res = await api.delete(`/items/${deleting.id}`, withReason(reason));
      if (isPendingApproval(res)) notify(APPROVAL_MESSAGE, 'info');
      else notify(`${deleting.item_code} deleted`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  };

  const canPrint = can('tags.print');

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Every piece and biscuit in the shop, priced at today's gold rate"
        actions={
          <Box sx={{ display: 'flex', gap: 1 }}>
            {canPrint && selected.size > 0 && (
              <Button variant="outlined" startIcon={<LabelIcon />} onClick={() => setPrinting([...selected.values()])}>
                Print tags ({selected.size})
              </Button>
            )}
            {can('items.create') && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add item</Button>
            )}
          </Box>
        }
      />

      {summary && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="gold" label="Pieces in stock" note={`${summary.item_lines} item lines`} value={formatAmount(summary.pieces)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="light" label="Gold in stock" note="Net weight of all pieces" value={formatAmount(summary.gold_weight_g)} unit="g" />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard tone="gray" label="Stock value today" value={formatAmount(Math.round(summary.value_now))}
              note={summary.without_price ? `${summary.without_price} line(s) have no gold price yet` : 'At today’s gold price'}
              to={can('gold_prices.view') ? '/gold-prices' : undefined} />
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
            sx={{ flex: '1 1 260px', maxWidth: 380 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          />
          <TextField select label="Category" value={filters.category_id} onChange={setFilter('category_id')} sx={{ width: 170 }}>
            <MenuItem value="">All</MenuItem>
            {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField select label="Karat" value={filters.karat_id} onChange={setFilter('karat_id')} sx={{ width: 120 }}>
            <MenuItem value="">All</MenuItem>
            {karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>)}
          </TextField>
          <TextField select label="Status" value={filters.status} onChange={setFilter('status')} sx={{ width: 160 }}>
            <MenuItem value="all">All</MenuItem>
            {Object.entries(STATUS).map(([value, s]) => <MenuItem key={value} value={value}>{s.label}</MenuItem>)}
          </TextField>
          {selected.size > 0 && (
            <Button size="small" onClick={() => setSelected(new Map())} sx={{ alignSelf: 'center' }}>Clear selection</Button>
          )}
        </Box>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {canPrint && (
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={pageAllSelected} onChange={togglePage} slotProps={{ input: { 'aria-label': 'Select page' } }} />
                  </TableCell>
                )}
                <TableCell>Code</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Karat</TableCell>
                <TableCell align="right">Net wt</TableCell>
                <TableCell align="right">Wastage</TableCell>
                <TableCell align="right">Making</TableCell>
                <TableCell align="right">Price today</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((i) => (
                <TableRow key={i.id} hover selected={selected.has(i.id)}>
                  {canPrint && (
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selected.has(i.id)} onChange={() => toggle(i)} slotProps={{ input: { 'aria-label': `Select ${i.item_code}` } }} />
                    </TableCell>
                  )}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{i.item_code}</Typography>
                    {i.item_code !== i.barcode && <Typography variant="caption" color="text.secondary">{i.barcode}</Typography>}
                  </TableCell>
                  <TableCell sx={{ minWidth: 180 }}>
                    <Typography variant="body2">{i.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{i.category_name}</Typography>
                  </TableCell>
                  <TableCell>{i.karat_name}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(i.net_weight_g)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{Number(i.wastage_g) ? formatWeight(i.wastage_g) : '—'}</TableCell>
                  <TableCell align="right">{Number(i.making_charge) ? formatMoney(i.making_charge) : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <PriceRange item={i} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: i.stock_qty === 0 && i.status === 'in_stock' ? 'error.main' : undefined }}>
                    {i.stock_qty}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={STATUS[i.status].label} color={STATUS[i.status].color} />
                    {i.tag_print_count === 0 && i.status === 'in_stock' && (
                      <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>No tag yet</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={can('items.adjust_stock') ? 'Add / take out stock · history' : 'Stock history'}>
                      <IconButton size="small" onClick={() => setStockItem(i)}><StockIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {canPrint && (
                      <Tooltip title="Print tag"><IconButton size="small" onClick={() => setPrinting([i])}><LabelIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('items.edit') && !['sold', 'with_craftsman'].includes(i.status) && (
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(i)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                    {can('items.delete') && i.source === 'opening' && i.status !== 'sold' && (
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleting(i)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !data.items.length && (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {filters.search ? `Nothing matches “${filters.search}”` : 'No items here yet'}
                  </TableCell>
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
          rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        />
      </Card>

      {editing && (
        <ItemFormDialog
          item={editing.id ? editing : null}
          categories={categories}
          karats={karats}
          onClose={() => setEditing(null)}
          onSaved={(saved, printNow) => {
            setEditing(null);
            load();
            if (printNow) setPrinting([saved]);
          }}
        />
      )}
      {stockItem && <StockDialog item={stockItem} onClose={() => setStockItem(null)} onChanged={load} />}
      {printing && (
        <PrintTagsDialog items={printing} onClose={() => setPrinting(null)} onPrinted={() => { setSelected(new Map()); load(); }} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete item"
        message={`Delete ${deleting?.item_code} (${deleting?.name})? Only items with no purchase, sale or craft history can be deleted.`}
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
