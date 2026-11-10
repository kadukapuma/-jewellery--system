import { useEffect, useState } from 'react';
import { Autocomplete, Box, Button, TextField, Typography } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import SalesmanFormDialog from './SalesmanFormDialog';

export default function SalesmanPicker({ value, onChange }) {
  const { can } = useAuth();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/salesmen', { params: { active: 'true' } })
      .then((res) => active && setOptions(res.data))
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Autocomplete
          sx={{ flex: 1 }}
          size="small"
          value={value}
          options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
          getOptionLabel={(o) => `${o.name} (${o.code})`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          inputValue={input}
          onInputChange={(e, v) => setInput(v)}
          onChange={(e, v) => onChange(v)}
          renderOption={(props, o) => (
            <li {...props} key={o.id}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[o.code, o.phone].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField {...params} label="Salesman" placeholder="Select salesman" />
          )}
        />
        {can('salesmen.create') && (
          <Button
            variant="outlined"
            onClick={() => setAdding(true)}
            sx={{ minWidth: 0, px: 1.5 }}
            aria-label="Add salesman"
            title="Add salesman"
          >
            <PersonAddIcon fontSize="small" />
          </Button>
        )}
      </Box>
      {adding && (
        <SalesmanFormDialog
          initialName={input}
          onClose={() => setAdding(false)}
          onSaved={(sm) => {
            setAdding(false);
            setOptions((prev) => [sm, ...prev]);
            onChange(sm);
          }}
        />
      )}
    </>
  );
}

