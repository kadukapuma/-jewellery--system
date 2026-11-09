import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { getUserProfile } from '../modules/auth/auth.service.js';

export async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new HttpError(401, 'Your session has expired, please log in again');
  }

  const user = await getUserProfile(payload.sub);
  if (!user || !user.is_active || !user.role_active) {
    throw new HttpError(401, 'This account is disabled');
  }
  req.user = { ...user, permissionSet: new Set(user.permissions) };
  next();
}

// Blocks everything except /auth routes until a forced password change is done.
export function requirePasswordChanged(req, res, next) {
  if (req.user.must_change_password) {
    throw new HttpError(403, 'Please change your password first', 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
}

export function hasPermission(req, code) {
  return req.user.is_super_admin || req.user.permissionSet.has(code);
}

// Admin role only (roles.is_super_admin) - user, role and settings changes and the Danger Zone.
export function requireAdmin(req, res, next) {
  if (req.user.is_super_admin) return next();
  throw new HttpError(403, 'Only Admin can do this');
}

// Passes if the user has ANY of the given permission codes.
export function requirePermission(...codes) {
  return (req, res, next) => {
    if (req.user.is_super_admin || codes.some((c) => req.user.permissionSet.has(c))) return next();
    throw new HttpError(403, 'You do not have permission to do this');
  };
}
