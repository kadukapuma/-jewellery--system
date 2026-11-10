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

// Labels for showing a customer receipt's method. 'old_gold' is the value of gold taken in:
// never picked by hand, so it is not in PAYMENT_METHODS (the dropdowns).
export const METHOD_LABELS = { ...PAYMENT_METHODS, old_gold: 'Old gold' };
