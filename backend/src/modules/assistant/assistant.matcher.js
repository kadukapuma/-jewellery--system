// Rule-based understanding for the robot assistant: no AI, no network.
// Each intent lists keyword groups; a question scores a point per group it hits.
// Pure functions only, so they can be unit tested without a database.

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-./]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Each entry: one "group" = any of these words counts once. `weight` lets a strong word win.
export const INTENT_RULES = [
  { id: 'whoami', groups: [['who am i', 'my role', 'my permission', 'my permissions', 'my access', 'what can i access', 'my account']], weight: 2 },
  { id: 'sales', groups: [['sale', 'sales', 'sold', 'bill', 'bills', 'invoice', 'invoices', 'revenue', 'income', 'turnover', 'wikunum', 'vikunum']] },
  { id: 'dues', groups: [['due', 'dues', 'owe', 'owed', 'owing', 'outstanding', 'credit', 'overdue', 'unpaid', 'receivable', 'naya', 'hinga']] },
  { id: 'gold_price', groups: [['gold', 'ran', 'karat', 'carat', 'pawn', 'pound', 'sovereign'], ['price', 'prices', 'rate', 'rates', 'mila']] },
  { id: 'stock', groups: [['stock', 'inventory', 'pieces', 'items in shop', 'how many items', 'total weight', 'stock value', 'thogaya']] },
  { id: 'customer', groups: [['customer', 'customers', 'client', 'balance of', 'account of', 'paribhogika']] },
  { id: 'item', groups: [['item', 'barcode', 'code', 'product', 'lookup']] },
  { id: 'repairs', groups: [['repair', 'repairs', 'fix', 'fixing', 'service job', 'ready to collect', 'collect']] },
  { id: 'day_end', groups: [['day end', 'day-end', 'dayend', 'closing', 'close the day', 'closed', 'cash in hand', 'expected cash', 'money in', 'money out']] },
  { id: 'workshop', groups: [['workshop', 'craftsman', 'craftsmen', 'craft', 'job', 'jobs', 'making', 'with craftsman']] },
  { id: 'supplier_dues', groups: [['supplier', 'suppliers', 'purchase', 'purchases', 'payable', 'vendor']] },
  // Last, so "hi, what are today's sales" is about sales.
  { id: 'help', groups: [['help', 'what can you do', 'commands', 'options', 'menu', 'hello', 'hi', 'hey', 'udaw', 'udav']] },
];

// "rng-102", "SR001", "#123", "8901234567890" -> candidate code. Needs at least one digit.
const CODE_RE = /(?:^|\s)#?([a-z]{0,6}[-/]?\d[\w\-/]*)(?=\s|$)/i;

function hasWord(text, word) {
  if (word.includes(' ')) return text.includes(word);
  return new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?(\\s|$)`).test(text);
}

export function scoreIntents(text) {
  const t = normalize(text);
  return INTENT_RULES.map((rule) => {
    let score = 0;
    for (const group of rule.groups) if (group.some((w) => hasWord(t, w))) score += 1;
    // An intent with two groups only counts when both match well; one group alone is weaker.
    const full = score === rule.groups.length;
    return { id: rule.id, score: score * (rule.weight || 1) + (full && rule.groups.length > 1 ? 1 : 0) };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

export function extractPeriod(text) {
  const t = normalize(text);
  if (/\byesterday\b|\biye\b/.test(t)) return 'yesterday';
  if (/\b(this|current) week\b|\bweek\b|\bmeesathiye\b/.test(t)) return 'week';
  if (/\blast month\b|\bprevious month\b/.test(t)) return 'last_month';
  if (/\b(this|current) month\b|\bmonth\b|\bmasaye\b/.test(t)) return 'month';
  if (/\b(this|current) year\b|\byear\b/.test(t)) return 'year';
  return 'today';
}

export function extractKarat(text) {
  const m = normalize(text).match(/\b(\d{2})\s*(k|kt|karat|carat|ct)\b/);
  return m ? `${m[1]}` : null;
}

export function extractCode(text) {
  const t = normalize(text).replace(/\b\d{2}\s*(k|kt|karat|carat|ct)\b/g, ' ');
  const m = t.match(CODE_RE);
  return m ? m[1].toUpperCase() : null;
}

const STOP = new Set([
  'customer', 'customers', 'client', 'balance', 'of', 'for', 'the', 'what', 'is', 'how', 'much', 'does', 'owe', 'owes',
  'account', 'show', 'me', 'find', 'check', 'due', 'dues', 'details', 'about', 'a', 'an', 'please', 'pls', 'tell',
  'statement', 'outstanding', 'credit', 's', 'item', 'items', 'barcode', 'code', 'product', 'lookup', 'search', 'named',
  'called', 'have', 'we', 'do', 'any', 'in',
]);

// Words left after removing filler: "balance of nimal perera" -> "nimal perera".
export function extractName(text) {
  const words = normalize(text).split(' ').filter((w) => w && !STOP.has(w));
  const name = words.join(' ').trim();
  return name.length >= 2 ? name.slice(0, 100) : null;
}

export function extractRepairStatus(text) {
  const t = normalize(text);
  if (/\bready\b|\bcollect/.test(t)) return 'ready';
  if (/\bwith craftsman\b|\bat craftsman\b/.test(t)) return 'with_craftsman';
  return 'open';
}

// Picks the best intent and the arguments it needs.
export function understand(text) {
  const scores = scoreIntents(text);
  const code = extractCode(text);
  let best = scores[0]?.id ?? null;

  // A bare code ("RNG-102") with nothing else is an item lookup.
  if (!best && code) best = 'item';
  // "sales today due" style ties: prefer the more specific money question.
  if (best === 'sales' && scores.find((s) => s.id === 'dues')?.score >= scores[0].score) best = 'dues';
  // "supplier dues" / "what do we owe suppliers" is about suppliers, not customers.
  if (best === 'dues' && scores.some((s) => s.id === 'supplier_dues')) best = 'supplier_dues';
  // "customer dues" -> total dues unless a name is given.
  if (best === 'customer' && !extractName(text) && scores.some((s) => s.id === 'dues')) best = 'dues';
  // A repair number like R-0012 asked with "repair".
  if (best === 'item' && scores.some((s) => s.id === 'repairs')) best = 'repairs';

  if (!best) return { intent: null, args: {}, alternatives: [] };

  const args = {};
  if (best === 'sales' || best === 'workshop') args.period = extractPeriod(text);
  if (best === 'gold_price') args.karat = extractKarat(text);
  if (best === 'item') { args.code = code; args.name = code ? null : extractName(text); }
  if (best === 'repairs') { args.status = extractRepairStatus(text); args.code = code; }
  if (best === 'customer') args.name = extractName(text);
  return { intent: best, args, alternatives: scores.slice(1, 3).map((s) => s.id) };
}

// Date range for a period name, computed in JS from the DB's today ('YYYY-MM-DD').
export function periodRange(period, today) {
  const d = new Date(`${today}T00:00:00Z`);
  const ymd = (x) => x.toISOString().slice(0, 10);
  const add = (x, days) => { const y = new Date(x); y.setUTCDate(y.getUTCDate() + days); return y; };
  switch (period) {
    case 'yesterday': { const y = ymd(add(d, -1)); return { from: y, to: y, label: 'yesterday' }; }
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return { from: ymd(add(d, -dow)), to: today, label: 'this week' };
    }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today, label: 'this month' };
    case 'last_month': {
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
      return { from: ymd(first), to: ymd(last), label: 'last month' };
    }
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'this year' };
    default: return { from: today, to: today, label: 'today' };
  }
}
