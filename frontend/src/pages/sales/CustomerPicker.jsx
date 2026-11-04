import { useEffect, useState } from 'react';
import { Autocomplete, Box, Button, TextField, Typography } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatMoney } from '../../utils/format';
import CustomerFormDialog from './CustomerFormDialog';

// Search customers by name / phone / NIC; add a new one without leaving the counter.
export default function CustomerPicker({ value, onChange }) {
  const { can } = useAuth();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api.get('/customers', { params: { search: input, page_size: 20 } })
        .then((res) => active && setOptions(res.data.customers))
        .catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [input]);

  return (
    <>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Autocomplete
          sx={{ flex: 1 }}
          size="small"
          value={value}
          options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
          getOptionLabel={(o) => `${o.name}${o.phone ? ` · ${o.phone}` : ''}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(x) => x}
          onInputChange={(e, v, reason) => reason === 'input' && setInput(v)}
          onChange={(e, v) => onChange(v)}
          renderOption={(props, o) => (
            <li {...props} key={o.id}>
              <Box>
                <Typography variant="body2">{o.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[o.phone, o.nic].filter(Boolean).join(' · ')}{o.balance ? ` · ${o.balance > 0 ? 'owes' : 'advance'} ${formatMoney(Math.abs(o.balance))}` : ''}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Customer" placeholder="Walk-in (no customer)" />}
        />
        {can('customers.create') && (
          <Button variant="outlined" onClick={() => setAdding(true)} sx={{ minWidth: 0, px: 1.5 }} aria-label="Add customer">
            <PersonAddIcon fontSize="small" />
          </Button>
        )}
      </Box>
      {adding && (
        <CustomerFormDialog
          initialName={input}
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); onChange(c); }}
        />
      )}
    </>
  );
}
