import { Children, isValidElement, useMemo, useState } from 'react';
import {
  Box, DialogContent, DialogTitle, InputAdornment, List, ListItemButton, ListItemText, TablePagination,
  TextField as MuiTextField, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import SearchIcon from '@mui/icons-material/Search';
import Dialog from './Dialog';
import { gold } from '../theme';

const PAGE_SIZE = 8;

// Same rule as MUI's Select, so an id of 3 matches a value of "3".
const same = (a, b) => (typeof b === 'object' && b !== null ? a === b : String(a) === String(b));

// Plain text of a node, for searching ("22K · 4×2 mm" etc.).
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

// Options come from <MenuItem value=…>label</MenuItem> children, exactly like <TextField select>.
function readOptions(children) {
  return Children.toArray(children)
    .filter((c) => isValidElement(c) && c.props.value !== undefined)
    .map((c) => ({ value: c.props.value, label: c.props.children, text: textOf(c.props.children), disabled: !!c.props.disabled }));
}

// A select field that opens a popup with a search bar and a paged list, instead of a dropdown.
// Same props as <TextField select>: label, value, onChange(e) with e.target.value, MenuItem children.
export default function SearchSelect({
  children, value, onChange, name, label, disabled, slotProps, select: _select, SelectProps: _sp, ...props
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const selected = options.find((o) => same(o.value, value));
  const shown = selected ? selected.text : '';

  const term = search.trim().toLowerCase();
  const filtered = term ? options.filter((o) => o.text.toLowerCase().includes(term)) : options;
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const pageOptions = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const openPopup = () => {
    if (disabled) return;
    setSearch('');
    // Start on the page holding the current choice.
    const at = options.findIndex((o) => same(o.value, value));
    setPage(at > 0 ? Math.floor(at / PAGE_SIZE) : 0);
    setOpen(true);
  };
  const choose = (o) => {
    if (o.disabled) return;
    setOpen(false);
    onChange?.({ target: { value: o.value, name } });
  };

  return (
    <>
      <MuiTextField
        {...props}
        name={name}
        label={label}
        value={shown}
        disabled={disabled}
        onClick={openPopup}
        onKeyDown={(e) => {
          if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); openPopup(); }
        }}
        slotProps={{
          ...slotProps,
          inputLabel: { ...(shown ? { shrink: true } : {}), ...slotProps?.inputLabel },
          htmlInput: { readOnly: true, style: { cursor: disabled ? 'default' : 'pointer' }, ...slotProps?.htmlInput },
          input: {
            sx: { cursor: disabled ? 'default' : 'pointer' },
            endAdornment: <InputAdornment position="end"><ArrowDropDownIcon color={disabled ? 'disabled' : 'action'} /></InputAdornment>,
            ...slotProps?.input,
          },
        }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{label ? `Select ${textOf(label).replace(/…$/, '').toLowerCase()}` : 'Select'}</DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <MuiTextField
            autoFocus
            placeholder="Search…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pageOptions.length) { e.preventDefault(); choose(pageOptions.find((o) => !o.disabled) || pageOptions[0]); }
            }}
            sx={{ mt: 0.5, mb: 1 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
          <List dense disablePadding sx={{ minHeight: PAGE_SIZE * 40 }}>
            {pageOptions.map((o) => {
              const isSelected = same(o.value, value);
              return (
                <ListItemButton
                  key={String(o.value)}
                  selected={isSelected}
                  disabled={o.disabled}
                  onClick={() => choose(o)}
                  sx={{ borderRadius: 2, minHeight: 40 }}
                >
                  <ListItemText primary={o.label} slotProps={{ primary: { sx: { fontWeight: isSelected ? 600 : 400 } } }} />
                  {isSelected && <CheckIcon fontSize="small" sx={{ color: gold[700] }} />}
                </ListItemButton>
              );
            })}
            {!pageOptions.length && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {term ? `Nothing matches “${search.trim()}”` : 'Nothing to choose from'}
                </Typography>
              </Box>
            )}
          </List>
        </DialogContent>
        <TablePagination
          component="div"
          count={filtered.length}
          page={current}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[]}
          onPageChange={(e, p) => setPage(p)}
          sx={{ px: 1 }}
        />
      </Dialog>
    </>
  );
}
