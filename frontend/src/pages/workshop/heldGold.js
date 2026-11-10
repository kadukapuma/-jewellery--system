import { formatWeight } from '../../utils/pricing';

// "3.000 g 22K · 1.500 g 18K" from a craftsman's gold_by_karat list.
export function heldByKaratText(list) {
  return (list || []).map((g) => `${formatWeight(g.gold_g)} ${g.karat_name}`).join(' · ');
}

// Gold of one karat the craftsman holds.
export function heldOfKarat(craftsman, karatId) {
  return (craftsman?.gold_by_karat || []).find((g) => g.karat_id === karatId)?.gold_g ?? 0;
}
