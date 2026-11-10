import { useEffect, useMemo, useState } from 'react';
import { Box, Link, MenuItem } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import TextField from './TextField';
import { useAuth } from '../auth/AuthContext';
import { formatMoney } from '../utils/format';
import { useBankAccounts } from '../utils/bankAccounts';

// Choose the bank first, then the account at that bank. value / onChange work with the account id.
//   excludeId: an account that cannot be chosen (the "from" side of a bank -> bank transfer).
//   showBalance: show the account's balance under the field (when money is taken out of it).
export default function BankAccountPicker({
  value, onChange, error, label = 'Account', bankLabel = 'Bank', excludeId = null, showBalance = false, disabled = false,
}) {
  const { can } = useAuth();
  const { accounts, loading } = useBankAccounts();
  const usable = useMemo(
    () => accounts.filter((a) => (a.is_active || a.id === Number(value)) && a.id !== Number(excludeId)),
    [accounts, value, excludeId],
  );
  const banks = useMemo(() => {
    const seen = new Map();
    for (const a of usable) if (!seen.has(a.bank_id)) seen.set(a.bank_id, a.bank_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [usable]);

  const selected = usable.find((a) => a.id === Number(value)) || null;
  const [bankId, setBankId] = useState(selected?.bank_id ?? '');

  // Follow the account when it is set from outside, and pick the only bank when there is just one.
  useEffect(() => {
    if (selected && selected.bank_id !== bankId) setBankId(selected.bank_id);
    else if (!selected && bankId === '' && banks.length === 1) setBankId(banks[0].id);
  }, [selected, banks]); // eslint-disable-line react-hooks/exhaustive-deps

  const ofBank = usable.filter((a) => a.bank_id === bankId);

  // A bank with a single account: choose it straight away.
  useEffect(() => {
    if (bankId !== '' && !selected && ofBank.length === 1) onChange(ofBank[0].id);
  }, [bankId, ofBank.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && !usable.length) {
    return (
      <Box sx={{ color: error ? 'error.main' : 'text.secondary', fontSize: 14, py: 1 }}>
        No bank accounts set up yet.{' '}
        {can('bank_accounts.manage') ? <Link component={RouterLink} to="/bank-accounts">Add a bank account</Link> : 'Ask a manager to add one.'}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      <TextField
        select label={bankLabel} value={bankId} disabled={disabled} sx={{ flex: 1, minWidth: 140 }}
        error={!!error && bankId === ''}
        onChange={(e) => { setBankId(e.target.value); onChange(''); }}
      >
        {banks.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
      </TextField>
      <TextField
        select label={label} value={selected ? selected.id : ''} disabled={disabled || bankId === ''} sx={{ flex: 1.4, minWidth: 180 }}
        error={!!error} helperText={error || (showBalance && selected ? `Balance: ${formatMoney(selected.balance)}` : undefined)}
        onChange={(e) => onChange(e.target.value)}
      >
        {ofBank.map((a) => <MenuItem key={a.id} value={a.id}>{`${a.account_name} · ${a.account_no}`}</MenuItem>)}
      </TextField>
    </Box>
  );
}
