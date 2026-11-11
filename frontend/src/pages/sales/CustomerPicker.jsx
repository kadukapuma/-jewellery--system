import { useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatMoney } from '../../utils/format';
import RecordPicker from '../../components/RecordPicker';
import CustomerFormDialog from './CustomerFormDialog';

const loadCustomers = ({ search, page, pageSize }) =>
  api.get('/customers', { params: { search: search || undefined, page, page_size: pageSize } })
    .then((res) => ({ rows: res.data.customers, total: res.data.total }));

// Find customers by name / phone / NIC in a popup; add a new one without leaving the counter.
export default function CustomerPicker({ value, onChange, label = 'Customer', placeholder = 'Walk-in (no customer)', ...props }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(null);

  return (
    <>
      <RecordPicker
        {...props}
        sx={{ width: '100%', ...props.sx }}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        load={loadCustomers}
        getLabel={(o) => `${o.name}${o.phone ? ` · ${o.phone}` : ''}`}
        getSecondary={(o) => [
          [o.phone, o.nic].filter(Boolean).join(' · '),
          o.balance ? `${o.balance > 0 ? 'owes' : 'advance'} ${formatMoney(Math.abs(o.balance))}` : '',
        ].filter(Boolean).join(' · ')}
        addLabel="Add customer"
        onAdd={can('customers.create') ? (search) => setAdding(search) : undefined}
      />
      {adding !== null && (
        <CustomerFormDialog
          initialName={adding}
          onClose={() => setAdding(null)}
          onSaved={(c) => { setAdding(null); onChange(c); }}
        />
      )}
    </>
  );
}
