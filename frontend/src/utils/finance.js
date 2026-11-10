// What each money movement is (finance overview "kind").
export const MONEY_KINDS = {
  receipt: { label: 'Customer receipt', color: 'success' },
  supplier_payment: { label: 'Supplier payment', color: 'warning' },
  craftsman_payment: { label: 'Craftsman payment', color: 'warning' },
  expense: { label: 'Expense', color: 'error' },
  old_gold: { label: 'Old gold bought', color: 'warning' },
  opening: { label: 'Opening balance', color: 'default' },
  capital_in: { label: 'Capital in', color: 'info' },
  drawing: { label: 'Drawing', color: 'info' },
  deposit: { label: 'Cash → bank', color: 'default' },
  withdrawal: { label: 'Bank → cash', color: 'default' },
};

// Manual cash / bank entries. `pickAccount`: the user chooses Cash or Bank; transfers know their direction.
export const CASH_ENTRY_TYPES = {
  opening: { label: 'Opening balance', hint: 'Money the shop had when it started using the system', pickAccount: true },
  capital_in: { label: 'Capital in', hint: 'Owner puts money into the shop', pickAccount: true },
  drawing: { label: 'Drawing', hint: 'Owner takes money out of the shop', pickAccount: true },
  deposit: { label: 'Deposit cash to bank', hint: 'Cash in hand goes down, bank goes up', pickAccount: false },
  withdrawal: { label: 'Withdraw cash from bank', hint: 'Bank goes down, cash in hand goes up', pickAccount: false },
};

export const ACCOUNTS = { cash: 'Cash in hand', bank: 'Bank' };
