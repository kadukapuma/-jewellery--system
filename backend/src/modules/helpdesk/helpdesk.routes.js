import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { getSetting } from '../../utils/settings.js';
import * as taskManager from '../../services/taskManager.service.js';

// Help desk: the robot chat sends support requests to the system provider's Task Manager.
// This router is only a proxy - nothing is stored here, and the API key never leaves the server.
const router = Router();

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
]);
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|pdf)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype) && ALLOWED_EXT.test(file.originalname)) return cb(null, true);
    cb(new HttpError(422, `"${file.originalname}" is not allowed. Attach JPG, PNG, GIF, WEBP or PDF files only.`));
  },
});

// Accepts files under "files" or "files[]".
function receiveFiles(req, res, next) {
  upload.fields([{ name: 'files', maxCount: MAX_FILES }, { name: 'files[]', maxCount: MAX_FILES }])(req, res, (err) => {
    if (!err) {
      req.uploaded = [...(req.files?.files ?? []), ...(req.files?.['files[]'] ?? [])];
      if (req.uploaded.length > MAX_FILES) return next(new HttpError(422, `Attach up to ${MAX_FILES} files.`));
      return next();
    }
    if (err instanceof HttpError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(422, 'Each file must be 10 MB or smaller.'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new HttpError(422, `Attach up to ${MAX_FILES} files.`));
    }
    next(err);
  });
}

const optional = (max) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const requestSchema = z.object({
  title: z.string({ error: 'Enter a short title' }).trim().min(1, 'Enter a short title').max(255),
  task_type: z.string({ error: 'Choose what kind of help you need' }).trim().min(1, 'Choose what kind of help you need').max(50),
  priority: optional(20),
  description: z.string({ error: 'Describe the problem' }).trim().min(1, 'Describe the problem').max(10000),
  page_url: optional(500),
  requester_phone: optional(50),
});

async function requesterName(user) {
  let code = taskManager.branchCode();
  if (!code) {
    try {
      code = await getSetting('shop_name', '');
    } catch {
      code = '';
    }
  }
  return code ? `${user.username} (${code})` : user.username;
}

// Is the help desk switched on? Lets the chat say so without making a failing call.
router.get('/status', requirePermission('helpdesk.view', 'helpdesk.create'), (req, res) => {
  res.json({ success: true, data: { configured: taskManager.isConfigured() } });
});

router.get('/meta', requirePermission('helpdesk.view', 'helpdesk.create'), async (req, res) => {
  res.json({ success: true, data: await taskManager.getMeta() });
});

router.get('/requests', requirePermission('helpdesk.view'), async (req, res) => {
  res.json({ success: true, data: await taskManager.listRequests() });
});

router.get('/requests/:id', requirePermission('helpdesk.view'), async (req, res) => {
  const id = parseId(req.params.id);
  res.json({ success: true, data: await taskManager.getRequest(id) });
});

router.post('/requests', requirePermission('helpdesk.create'), receiveFiles, async (req, res) => {
  const data = requestSchema.parse(req.body ?? {});
  const result = await taskManager.createRequest(
    {
      ...data,
      requester_name: await requesterName(req.user),
      requester_email: req.user.email || undefined,
      requester_phone: data.requester_phone ?? (req.user.phone || undefined),
    },
    req.uploaded,
  );
  res.status(201).json({
    success: true,
    message: result.message || 'Request submitted successfully.',
    data: result.data ?? null,
  });
});

export default router;
