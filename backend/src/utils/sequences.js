// Next running number from document_sequences, e.g. 'ITEM' -> 'JW000001'.
// Must run inside a transaction: the row lock keeps two saves from getting the same number.
export async function nextDocumentNumber(conn, code) {
  const [[seq]] = await conn.query(
    'SELECT prefix, next_number, pad_length FROM document_sequences WHERE code = ? FOR UPDATE',
    [code],
  );
  if (!seq) throw new Error(`Missing document sequence "${code}"`);
  await conn.query('UPDATE document_sequences SET next_number = next_number + 1 WHERE code = ?', [code]);
  return seq.prefix + String(seq.next_number).padStart(seq.pad_length, '0');
}
