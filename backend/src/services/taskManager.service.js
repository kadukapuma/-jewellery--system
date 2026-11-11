import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

// Talks to the system provider's Task Manager (Help Desk). Every call goes out from this server
// with the X-Api-Key header, so the key is never sent to the browser.

export const TIMEOUT_MS = 20_000;

export const MESSAGES = {
  notConfigured: 'The help desk is not configured yet. Please contact your system provider.',
  unreachable: 'Could not reach the help desk right now. Please try again shortly.',
  unauthorised: 'The help desk connection is not authorised. Please contact your system provider.',
  notFound: 'Request not found.',
  failed: 'The help desk could not handle this request. Please try again shortly.',
};

// Overridable in tests.
let options = { ...env.taskManager, fetch: (...args) => globalThis.fetch(...args) };

export function setTaskManagerOptions(next) {
  options = { ...options, ...next };
}

export function isConfigured() {
  return Boolean(options.url && options.key);
}

export function branchCode() {
  return options.branchCode || '';
}

async function call(method, path, body) {
  if (!isConfigured()) throw new HttpError(503, MESSAGES.notConfigured, 'HELPDESK_NOT_CONFIGURED');

  let response;
  try {
    response = await options.fetch(`${options.url}${path}`, {
      method,
      headers: { Accept: 'application/json', 'X-Api-Key': options.key },
      body, // FormData sets its own multipart Content-Type with the boundary
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // DNS failure, refused connection, timeout ...
    throw new HttpError(502, MESSAGES.unreachable, 'HELPDESK_UNREACHABLE');
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (response.ok) return json ?? {};

  switch (response.status) {
    case 401:
    case 403:
      throw new HttpError(502, MESSAGES.unauthorised, 'HELPDESK_UNAUTHORISED');
    case 404:
      throw new HttpError(404, MESSAGES.notFound);
    case 422: {
      const err = new HttpError(422, json?.message || 'Please check the details and try again.');
      err.errors = json?.errors ?? {};
      throw err;
    }
    default:
      throw new HttpError(502, MESSAGES.failed, 'HELPDESK_ERROR');
  }
}

export async function getMeta() {
  const json = await call('GET', '/integration/meta');
  return json.data ?? { task_types: [], priorities: [] };
}

export async function listRequests() {
  const json = await call('GET', '/integration/requests');
  return json.data ?? [];
}

export async function getRequest(id) {
  const json = await call('GET', `/integration/requests/${encodeURIComponent(id)}`);
  return json.data ?? null;
}

// fields: plain text fields; files: [{ buffer, originalname, mimetype }] (from multer)
export async function createRequest(fields, files = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  }
  for (const file of files) {
    form.append('files[]', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  }
  return call('POST', '/integration/requests', form);
}
