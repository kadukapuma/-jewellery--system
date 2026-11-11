import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import RecordPicker, { pageLocal } from '../../components/RecordPicker';
import SalesmanFormDialog from './SalesmanFormDialog';

const textOf = (o) => `${o.name} ${o.code || ''} ${o.phone || ''}`;

// Choose the salesman in a popup; add a new one without leaving the counter.
export default function SalesmanPicker({ value, onChange, label = 'Salesman', placeholder = 'Select salesman', ...props }) {
  const { can } = useAuth();
  const [options, setOptions] = useState([]);
  const [adding, setAdding] = useState(null);

  useEffect(() => {
    let active = true;
    api.get('/salesmen', { params: { active: 'true' } })
      .then((res) => active && setOptions(res.data))
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <>
      <RecordPicker
        {...props}
        sx={{ width: '100%', ...props.sx }}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        load={(q) => pageLocal(options, q, textOf)}
        reloadKey={options}
        getLabel={(o) => `${o.name}${o.code ? ` (${o.code})` : ''}`}
        getSecondary={(o) => o.phone || ''}
        addLabel="Add salesman"
        onAdd={can('salesmen.create') ? (search) => setAdding(search) : undefined}
      />
      {adding !== null && (
        <SalesmanFormDialog
          initialName={adding}
          onClose={() => setAdding(null)}
          onSaved={(sm) => {
            setAdding(null);
            setOptions((prev) => [sm, ...prev]);
            onChange(sm);
          }}
        />
      )}
    </>
  );
}
