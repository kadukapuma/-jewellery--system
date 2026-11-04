import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

function duplicateMessage(err) {
  const match = /Duplicate entry '(.*)' for key/.exec(err.sqlMessage || '');
  return match ? `"${match[1]}" already exists` : 'This record already exists';
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, code: err.code });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Please check the highlighted fields',
      errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: duplicateMessage(err) });
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ message: 'This record is in use and cannot be deleted' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid request body' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server' });
}
