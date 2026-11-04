import { useEffect, useState } from 'react';
import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, LinearProgress, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import api, { errorMessage } from '../../api/client';
import { formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import PriceRange from '../../components/PriceRange';

const sellable = (item) => item.stock_qty > 0 && item.current_gram_price !== null;

// Browse every in-stock item and pick one or more for the bill.
// single: one click picks one item and closes (used by craft jobs); params / canPick change which items show and can be picked.
export default function ItemPickerDialog({
  inCart = new Set(), onClose, onAdd, single = false, params: extraParams = { status: 'in_stock' }, canPick: allowed = sellable,
  title = 'Select items', emptyText = 'No items in stock match',
}) {
  const paramsKey = JSON.stringify(extraParams);
  const [categories, setCategories] = useState([]);
  const [karats, setKarats] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ search: '', category_id: '', karat_id: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(new Map()); // id -> item, kept across pages

  useEffect(() => {
    Promise.all([api.get('/categories'), api.get('/karats')])
      .then(([c, k]) => { setCategories(c.data); setKarats(k.data); })
      .catch(() => {});
  }, []);

  // Search as you type (short pause so every key press is not a request).
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      setFilters((f) => (f.search === searchText.trim() ? f : { ...f, search: searchText.trim() }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { ...filters, ...JSON.parse(paramsKey), page, page_size: pageSize };
    Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
    api.get('/items', { params })
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [filters, page, pageSize, paramsKey]);

  const canPick = (item) => allowed(item) && !inCart.has(item.id);

  const toggle = (item) => {
    if (!canPick(item)) return;
    if (single) { onAdd([item]); return; }
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  };

  const setFilter = (key) => (e) => { setPage(0); setFilters((f) => ({ ...f, [key]: e.target.value })); };

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <Box sx={{ display: 'flex', gap: 1.5, px: 3, pb: 2, flexWrap: 'wrap' }}>
        <TextField
          autoFocus
          placeholder="Search code, barcode or name"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          sx={{ flex: '1 1 240px', maxWidth: 360 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <TextField select label="Category" value={filters.category_id} onChange={setFilter('category_id')} sx={{ width: 180 }}>
          <MenuItem value="">All</MenuItem>
          {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        <TextField select label="Karat" value={filters.karat_id} onChange={setFilter('karat_id')} sx={{ width: 120 }}>
          <MenuItem value="">All</MenuItem>
          {karats.map((k) => <MenuItem key={k.id} value={k.id}>{k.name}</MenuItem>)}
        </TextField>
      </Box>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading && <LinearProgress />}
        {error && <Typography color="error" sx={{ p: 2 }}>{error}</Typography>}
        <TableContainer sx={{ maxHeight: '55vh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Code</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Karat</TableCell>
                <TableCell align="right">Net wt</TableCell>
                <TableCell align="right">Wastage</TableCell>
                <TableCell align="right">Making</TableCell>
                <TableCell align="right">Price today</TableCell>
                <TableCell align="right">In stock</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((i) => {
                const added = inCart.has(i.id);
                const disabled = !canPick(i);
                return (
                  <TableRow key={i.id} hover={!disabled} selected={picked.has(i.id)} onClick={() => toggle(i)}
                    onDoubleClick={() => { if (!disabled) onAdd([i]); }}
                    sx={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={picked.has(i.id) || added} disabled={disabled} slotProps={{ input: { 'aria-label': `Pick ${i.item_code}` } }} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{i.item_code}</TableCell>
                    <TableCell>
                      {i.name}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.category_name}</Typography>
                    </TableCell>
                    <TableCell>{i.karat_name}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(i.net_weight_g)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{Number(i.wastage_g) ? formatWeight(i.wastage_g) : '—'}</TableCell>
                    <TableCell align="right">{Number(i.making_charge) ? formatMoney(i.making_charge) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <PriceRange item={i} missingColor="warning.main" />
                    </TableCell>
                    <TableCell align="right">
                      {added ? <Chip size="small" label="On bill" /> : i.stock_qty}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && !data.items.length && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>{emptyText}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </DialogContent>
      <DialogActions>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto', ml: 1 }}>
          {single ? 'Click an item to choose it' : 'Click to tick, double-click to add one straight away'}
        </Typography>
        <Button onClick={onClose}>Cancel</Button>
        {!single && (
          <Button variant="contained" disabled={!picked.size} onClick={() => onAdd([...picked.values()])}>
            Add {picked.size || ''} to bill
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
