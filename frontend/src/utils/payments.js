export const PAYMENT_METHODS = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

export const PAYMENT_STATUS = {
  unpaid: { label: 'Unpaid', color: 'error' },
  partial: { label: 'Part paid', color: 'warning' },
  paid: { label: 'Paid', color: 'success' },
};

// Local YYYY-MM-DD for date inputs.
export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
