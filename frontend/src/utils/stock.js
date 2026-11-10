// Where an item came from (items.source).
export const ITEM_SOURCES = { purchase: 'Purchase', craft: 'Made by craftsman', opening: 'Opening stock', old_gold: 'Old gold' };

// Labels for stock_movements rows, shared by the item Stock window and the Stock history page.
export const MOVEMENT_TYPES = {
  purchase: 'Purchase',
  sale: 'Sale',
  craft_issue: 'To craftsman',
  craft_return: 'From craftsman',
  adjustment: 'Adjustment',
  old_gold_in: 'Old gold taken in',
};

export const STOCK_REASONS = {
  received: 'New stock received',
  returned: 'Returned to shop',
  found: 'Found in count',
  count_correction: 'Count correction',
  damaged: 'Damaged',
  lost: 'Lost / missing',
  other: 'Other',
  reversal: 'Reversed (undo)',
  old_gold_cancel: 'Old gold given back',
};

// Which reasons make sense for adding vs taking out stock.
export const REASONS_BY_DIRECTION = {
  in: ['received', 'returned', 'found', 'count_correction', 'other'],
  out: ['damaged', 'lost', 'count_correction', 'other'],
};

// A manual adjustment that Admin (or a user with items.reverse_stock) can undo.
export function canReverse(m) {
  return m.movement_type === 'adjustment' && m.ref_table === 'items' && !!m.reason && !m.reversed;
}

// Short description of where a movement came from.
export function movementLabel(m) {
  if (m.movement_type !== 'adjustment') return MOVEMENT_TYPES[m.movement_type] || m.movement_type;
  if (m.reason) return STOCK_REASONS[m.reason] || m.reason;
  if (m.ref_table === 'sales') return 'Bill cancelled';
  if (m.ref_table === 'purchases') return 'Purchase deleted / restored';
  return 'Item added / edited';
}

// Link to the bill / purchase / job a movement came from, if the user can open it.
export function movementLink(m) {
  if (m.ref_table === 'sales') return `/sales/${m.ref_id}`;
  if (m.ref_table === 'purchases') return `/purchases/${m.ref_id}`;
  if (m.ref_table === 'old_gold_receipts') return `/old-gold/${m.ref_id}`;
  return null;
}
