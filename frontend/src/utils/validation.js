// Same rules as the server (backend/src/utils/validation.js), checked before sending.
export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number';

export function passwordProblem(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(password)) return 'Password must contain a letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

export function emailProblem(email) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email, e.g. name@example.com';
  return null;
}
