import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// env.js insists on a JWT secret; these tests never reach MySQL (denied / unknown paths only).
process.env.JWT_SECRET ||= 'test-secret';

const { understand, periodRange, extractCode } = await import('../src/modules/assistant/assistant.matcher.js');
const { allowedIntents } = await import('../src/modules/assistant/assistant.intents.js');
const { default: assistantRoutes } = await import('../src/modules/assistant/assistant.routes.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const fakeReq = (permissions, extra = {}) => ({ user: { is_super_admin: false, permissionSet: new Set(permissions), ...extra } });

test('understands common questions', () => {
  const cases = [
    ['today sales', 'sales'],
    ["Hi, what are today's sales?", 'sales'],
    ['sales this month', 'sales'],
    ['gold price', 'gold_price'],
    ['22k gold rate', 'gold_price'],
    ['stock summary', 'stock'],
    ['how many items in stock', 'stock'],
    ['item RNG-000123', 'item'],
    ['RNG-000123', 'item'],
    ['customer dues', 'dues'],
    ['who owes money', 'dues'],
    ['balance of nimal perera', 'customer'],
    ['repairs ready to collect', 'repairs'],
    ['day end status', 'day_end'],
    ['workshop jobs', 'workshop'],
    ['supplier dues', 'supplier_dues'],
    ['who am i', 'whoami'],
    ['help', 'help'],
  ];
  for (const [text, want] of cases) assert.equal(understand(text).intent, want, text);
});

test('extracts arguments', () => {
  assert.equal(understand('sales yesterday').args.period, 'yesterday');
  assert.equal(understand('22k gold price').args.karat, '22');
  assert.equal(understand('item rng-000123').args.code, 'RNG-000123');
  assert.equal(understand('balance of nimal perera').args.name, 'nimal perera');
  assert.equal(understand('repairs ready').args.status, 'ready');
  assert.equal(extractCode('22k gold price'), null);
  assert.equal(understand('blah blah').intent, null);
});

test('period ranges', () => {
  assert.deepEqual(periodRange('today', '2026-11-11'), { from: '2026-11-11', to: '2026-11-11', label: 'today' });
  assert.equal(periodRange('yesterday', '2026-11-01').from, '2026-10-31');
  assert.equal(periodRange('month', '2026-11-11').from, '2026-11-01');
  assert.deepEqual(periodRange('last_month', '2026-03-15'), { from: '2026-02-01', to: '2026-02-28', label: 'last month' });
  assert.equal(periodRange('week', '2026-11-11').from, '2026-11-09'); // Wednesday -> Monday
});

test('only intents the user has permission for are allowed', () => {
  assert.deepEqual(allowedIntents(fakeReq([])).sort(), ['help', 'whoami']);
  assert.ok(allowedIntents(fakeReq(['gold_prices.view'])).includes('gold_price'));
  assert.ok(!allowedIntents(fakeReq(['gold_prices.view'])).includes('sales'));
  assert.ok(allowedIntents({ user: { is_super_admin: true, permissionSet: new Set() } }).includes('day_end'));
});

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { is_super_admin: false, role_name: 'Cashier', ...user, permissionSet: new Set(user.permissions ?? []) };
    next();
  });
  app.use('/api/assistant', assistantRoutes);
  app.use(errorHandler);
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('denies data the role cannot see, without reading it', async () => {
  const app = makeApp({ permissions: ['gold_prices.view'] });
  const { status, body } = await call(app, 'POST', '/api/assistant/ask', { text: 'today sales' });
  assert.equal(status, 200);
  assert.equal(body.data.denied, true);
  assert.match(body.data.reply, /Cashier/);
  assert.deepEqual(body.data.suggestions, ['Gold price']);
});

test('unknown question gets suggestions', async () => {
  const app = makeApp({ permissions: ['items.view'] });
  const { body } = await call(app, 'POST', '/api/assistant/ask', { text: 'xyzzy' });
  assert.equal(body.data.intent, null);
  assert.ok(body.data.suggestions.includes('Stock summary'));
});

test('capabilities follow permissions', async () => {
  const app = makeApp({ permissions: ['repairs.view'] });
  const { body } = await call(app, 'GET', '/api/assistant/capabilities');
  assert.deepEqual(body.data.map((c) => c.id).sort(), ['help', 'repairs', 'whoami']);
});

test('rejects empty question', async () => {
  const { status } = await call(makeApp({}), 'POST', '/api/assistant/ask', { text: '  ' });
  assert.equal(status, 400);
});
