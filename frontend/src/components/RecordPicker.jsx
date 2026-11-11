import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, List, ListItemButton,
  ListItemText, TablePagination, TextField as MuiTextField, Tooltip, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import Dialog from './Dialog';
import { gold } from '../theme';

const PAGE_SIZE = 8;

// A field that opens a popup to find and choose a record (customer, salesman, …) instead of a dropdown.
//   value / onChange(record | null)  – the chosen record object
//   load({ search, page, pageSize }) – resolves to { rows, total }; called as the user searches / pages
//   getLabel(record)                 – text shown in the field
//   getSecondary(record)             – optional second line in the list
//   onAdd(search)                    – optional; shows an "Add new" button in the popup
//   reloadKey                        – change it to reload the open list (e.g. once local data arrives)
export default function RecordPicker({
  value, onChange, load, getLabel, getSecondary, label, placeholder, required, disabled,
  error, helperText, size = 'small', sx, clearable = true, addLabel = 'Add new', onAdd, reloadKey,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.resolve(loadRef.current({ search: search.trim(), page, pageSize: PAGE_SIZE }))
        .then((res) => { if (active) { setRows(res.rows); setTotal(res.total); } })
        .catch(() => {})
        .finally(() => active && setLoading(false));
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [open, search, page, reloadKey]);

  const openPopup = () => {
    if (disabled) return;
    setSearch('');
    setPage(0);
    setOpen(true);
  };
  const choose = (r) => { setOpen(false); onChange?.(r); };
  const shown = value ? getLabel(value) : '';

  return (
    <>
      <MuiTextField
        label={label}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        error={error}
        helperText={helperText}
        size={size}
        sx={sx}
        value={shown}
        onClick={openPopup}
        onKeyDown={(e) => {
          if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); openPopup(); }
        }}
        slotProps={{
          inputLabel: shown || placeholder ? { shrink: true } : undefined,
          htmlInput: { readOnly: true, style: { cursor: disabled ? 'default' : 'pointer' } },
          input: {
            sx: { cursor: disabled ? 'default' : 'pointer' },
            endAdornment: (
              <InputAdornment position="end">
                {clearable && value && !disabled && (
                  <IconButton
                    size="small"
                    aria-label="Clear"
                    onClick={(e) => { e.stopPropagation(); onChange?.(null); }}
                    sx={{ mr: -0.5 }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                )}
                <ArrowDropDownIcon color={disabled ? 'disabled' : 'action'} />
              </InputAdornment>
            ),
          },
        }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{label ? `Select ${String(label).toLowerCase()}` : 'Select'}</DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, mb: 1 }}>
            <MuiTextField
              autoFocus
              fullWidth
              placeholder="Search…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rows.length && !loading) { e.preventDefault(); choose(rows[0]); }
              }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
            {onAdd && (
              <Tooltip title={addLabel}>
                <Button variant="outlined" onClick={() => { setOpen(false); onAdd(search.trim()); }} sx={{ whiteSpace: 'nowrap' }}>
                  + New
                </Button>
              </Tooltip>
            )}
          </Box>
          <Box sx={{ height: 4 }}>{loading && <LinearProgress />}</Box>
          <List dense disablePadding sx={{ minHeight: PAGE_SIZE * 48 }}>
            {rows.map((r) => {
              const isSelected = value && value.id === r.id;
              const secondary = getSecondary?.(r);
              return (
                <ListItemButton key={r.id} selected={isSelected} onClick={() => choose(r)} sx={{ borderRadius: 2, minHeight: 48 }}>
                  <ListItemText
                    primary={getLabel(r)}
                    secondary={secondary || null}
                    slotProps={{ primary: { sx: { fontWeight: isSelected ? 600 : 400 } } }}
                  />
                  {isSelected && <CheckIcon fontSize="small" sx={{ color: gold[700] }} />}
                </ListItemButton>
              );
            })}
            {!rows.length && !loading && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {search.trim() ? `Nothing matches “${search.trim()}”` : 'Nothing to choose from'}
                </Typography>
              </Box>
            )}
          </List>
        </DialogContent>
        <TablePagination
          component="div"
          count={total}
          page={Math.min(page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1))}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[]}
          onPageChange={(e, p) => setPage(p)}
          sx={{ px: 1 }}
        />
      </Dialog>
    </>
  );
}

// Page through an array already in memory (for short lists such as salesmen).
export function pageLocal(list, { search, page, pageSize }, textOf) {
  const term = search.toLowerCase();
  const filtered = term ? list.filter((r) => textOf(r).toLowerCase().includes(term)) : list;
  return { rows: filtered.slice(page * pageSize, page * pageSize + pageSize), total: filtered.length };
}
