import { useEffect, useState } from 'react';
import api from '../api/client';

// The shop's bank accounts (with balances), shared by every picker on the page and loaded once.
// Call refreshBankAccounts() after money moves or an account is added to see the new figures.
let cache = null;
let pending = null;
const listeners = new Set();

function load() {
  if (!pending) {
    pending = api.get('/bank-accounts')
      .then((res) => {
        cache = res.data;
        listeners.forEach((fn) => fn(cache));
        return cache;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

export function refreshBankAccounts() {
  return load().catch(() => cache);
}

// { accounts: [...], loading } – accounts include inactive ones; pickers show only active.
export function useBankAccounts() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    listeners.add(setData);
    if (!cache) load().catch(() => {});
    return () => { listeners.delete(setData); };
  }, []);
  return { accounts: data?.accounts || [], unassigned: data?.unassigned || 0, loading: !data };
}

// "BOC · Main 1234"
export const bankAccountLabel = (a) => (a ? `${a.bank_name} · ${a.account_name} ${a.account_no}` : '');

// Methods that need a bank account: everything except cash.
export const needsBankAccount = (method) => !!method && method !== 'cash' && method !== 'old_gold';

// "Bank transfer · BOC · Main 1234 · REF" for lists.
export const methodWithAccount = (label, row) =>
  [label, row?.bank_account_label, row?.reference_no].filter(Boolean).join(' · ');
