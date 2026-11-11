import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// env.js insists on a JWT secret; the help desk router never connects to MySQL in these tests.
process.env.JWT_SECRET ||= 'test-secret';

const taskManager = await import('../src/services/taskManager.service.js');
const { default: helpdeskRoutes } = await import('../src/modules/helpdesk/helpdesk.routes.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const BASE = 'https://tm.example.com/api';
const KEY = 'secret-key-123';

let calls;
let reply; // (url, init) => Response | throws

function mockFetch(url, init) {
  calls.push({ url, init });
  return reply(url, init);
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { ...user, permissionSet: new Set(user.permissions ?? []) };
    next();
  });
  app.use('/api/helpdesk', helpdeskRoutes);
  app.use(errorHandler);
  return app;
}

const staff = {
  id: 7, username: 'nimal', email: 'nimal@shop.lk', phone: '0771234567', is_super_admin: false,
  permissions: ['helpdesk.view', 'helpdesk.create'],
};

async function request(app, method, path, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      body,
      headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  calls = [];
  reply = () => json(200, { data: [] });
  taskManager.setTaskManagerOptions({ url: BASE, key: KEY, branchCode: 'BR01', fetch: mockFetch });
});

test('meta: sends X-Api-Key and Accept headers to the Task Manager', async () => {
  reply = () => json(200, { data: { task_types: ['Error', 'New'], priorities: ['Normal', 'Fire'] } });
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/meta');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.priorities, ['Normal', 'Fire']);
  assert.equal(calls[0].url, `${BASE}/integration/meta`);
  assert.equal(calls[0].init.headers['X-Api-Key'], KEY);
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.ok(calls[0].init.signal, 'request has a timeout signal');
});

test('the API key is never returned to the client', async () => {
  reply = () => json(200, { data: [{ id: 1, title: 'x' }] });
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/requests');
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(res.body).includes(KEY));
});

test('list and single request are proxied', async () => {
  reply = (url) => (url.endsWith('/requests')
    ? json(200, { data: [{ id: 101, status: 'Pending' }] })
    : json(200, { data: { id: 101, status: 'Accepted', task_number: 452 } }));
  const app = makeApp(staff);
  const list = await request(app, 'GET', '/api/helpdesk/requests');
  assert.equal(list.body.data[0].id, 101);
  const one = await request(app, 'GET', '/api/helpdesk/requests/101');
  assert.equal(one.body.data.task_number, 452);
  assert.equal(calls[1].url, `${BASE}/integration/requests/101`);
});

test('create: posts multipart with requester details and files', async () => {
  reply = () => json(201, { success: true, message: 'Request submitted successfully.', data: { id: 101, progress: 'Pending Review' } });
  const form = new FormData();
  form.append('title', 'Bill printer not working');
  form.append('task_type', 'Error');
  form.append('priority', 'Urgent');
  form.append('description', 'Nothing prints after the last update.');
  form.append('page_url', 'http://localhost:5173/sales/new');
  form.append('files[]', new Blob(['png-bytes'], { type: 'image/png' }), 'screen.png');

  const res = await request(makeApp(staff), 'POST', '/api/helpdesk/requests', form);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { success: true, message: 'Request submitted successfully.', data: { id: 101, progress: 'Pending Review' } });

  const sent = calls[0].init.body;
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(sent instanceof FormData);
  assert.equal(sent.get('title'), 'Bill printer not working');
  assert.equal(sent.get('requester_name'), 'nimal (BR01)');
  assert.equal(sent.get('requester_email'), 'nimal@shop.lk');
  assert.equal(sent.get('requester_phone'), '0771234567');
  const file = sent.get('files[]');
  assert.equal(file.name, 'screen.png');
  assert.equal(file.type, 'image/png');
});

test('create: rejects disallowed file types without calling the Task Manager', async () => {
  const form = new FormData();
  form.append('title', 't');
  form.append('task_type', 'Error');
  form.append('description', 'd');
  form.append('files[]', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
  const res = await request(makeApp(staff), 'POST', '/api/helpdesk/requests', form);
  assert.equal(res.status, 422);
  assert.equal(calls.length, 0);
});

test('create: more than 5 files is refused', async () => {
  const form = new FormData();
  form.append('title', 't');
  form.append('task_type', 'Error');
  form.append('description', 'd');
  for (let i = 0; i < 6; i += 1) form.append('files[]', new Blob(['x'], { type: 'image/png' }), `f${i}.png`);
  const res = await request(makeApp(staff), 'POST', '/api/helpdesk/requests', form);
  assert.equal(res.status, 422);
  assert.equal(calls.length, 0);
});

test('create: missing required fields fails locally', async () => {
  const form = new FormData();
  form.append('title', 'Only a title');
  const res = await request(makeApp(staff), 'POST', '/api/helpdesk/requests', form);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('missing config returns 503', async () => {
  taskManager.setTaskManagerOptions({ url: '', key: '' });
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/requests');
  assert.equal(res.status, 503);
  assert.equal(res.body.message, taskManager.MESSAGES.notConfigured);
  assert.equal(calls.length, 0);
});

test('unreachable Task Manager returns 502', async () => {
  reply = () => { throw new TypeError('fetch failed'); };
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/meta');
  assert.equal(res.status, 502);
  assert.equal(res.body.message, taskManager.MESSAGES.unreachable);
});

test('401 from Task Manager becomes 502 not authorised', async () => {
  reply = () => json(401, { message: 'Invalid key' });
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/requests');
  assert.equal(res.status, 502);
  assert.equal(res.body.message, taskManager.MESSAGES.unauthorised);
});

test('404 from Task Manager becomes 404 Request not found', async () => {
  reply = () => json(404, { message: 'No query results' });
  const res = await request(makeApp(staff), 'GET', '/api/helpdesk/requests/999');
  assert.equal(res.status, 404);
  assert.equal(res.body.message, 'Request not found.');
});

test('422 from Task Manager forwards message and errors', async () => {
  reply = () => json(422, { message: 'The task type field is invalid.', errors: { task_type: ['The selected task type is invalid.'] } });
  const form = new FormData();
  form.append('title', 't');
  form.append('task_type', 'Nonsense');
  form.append('description', 'd');
  const res = await request(makeApp(staff), 'POST', '/api/helpdesk/requests', form);
  assert.equal(res.status, 422);
  assert.equal(res.body.message, 'The task type field is invalid.');
  assert.deepEqual(res.body.errors, { task_type: ['The selected task type is invalid.'] });
});

test('permissions: users without helpdesk permissions are refused', async () => {
  const app = makeApp({ ...staff, permissions: [] });
  assert.equal((await request(app, 'GET', '/api/helpdesk/requests')).status, 403);
  const form = new FormData();
  form.append('title', 't');
  assert.equal((await request(app, 'POST', '/api/helpdesk/requests', form)).status, 403);
  assert.equal(calls.length, 0);
});

test('permissions: view-only users cannot create', async () => {
  const app = makeApp({ ...staff, permissions: ['helpdesk.view'] });
  const form = new FormData();
  form.append('title', 't');
  assert.equal((await request(app, 'POST', '/api/helpdesk/requests', form)).status, 403);
  assert.equal((await request(app, 'GET', '/api/helpdesk/requests')).status, 200);
});
