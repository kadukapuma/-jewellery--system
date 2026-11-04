// Labels for stock_movements rows, shared by the item Stock window and the Stock history page.
export const MOVEMENT_TYPES = {
  purchase: 'Purchase',
  sale: 'Sale',
  craft_issue: 'To craftsman',
  craft_return: 'From craftsman',
  adjustment: 'Adjustment',
};

export const STOCK_REASONS = {
  received: 'New stock received',
  returned: 'Returned to shop',
  found: 'Found in count',
  count_correction: 'Count correction',
  damaged: 'Damaged',
  lost: 'Lost / missing',
  other: 'Other',
};

// Which reasons make sense for adding vs taking out stock.
export const REASONS_BY_DIRECTION = {
  in: ['received', 'returned', 'found', 'count_correction', 'other'],
  out: ['damaged', 'lost', 'count_correction', 'other'],
};

// Short description of where a movement came from.
export function movementLabel(m) {
  if (m.movement_type !== 'adjustment') return MOVEMENT_TYPES[m.movement_type] || m.movement_type;
  if (m.reason) return STOCK_REASONS[m.reason] || m.reason;
  if (m.ref_table === 'sales') return 'Bill cancelled';
  return 'Item added / edited';
}

// Link to the bill / purchase / job a movement came from, if the user can open it.
export function movementLink(m) {
  if (m.ref_table === 'sales') return `/sales/${m.ref_id}`;
  if (m.ref_table === 'purchases') return `/purchases/${m.ref_id}`;
  return null;
}
