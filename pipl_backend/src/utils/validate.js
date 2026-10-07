const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[A-Za-z]{2,}$/;
const MAX_EMAIL_LEN = 254;

export function isValidEmail(value) {
  return typeof value === 'string' &&
    value.length > 3 &&
    value.length <= MAX_EMAIL_LEN &&
    EMAIL_RE.test(value);
}

export function toPositiveInt(value, max = 100000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > max) return null;
  return n;
}

export function toUserId(value) {
  const n = toPositiveInt(value, 2147483647);
  return n === null ? null : n;
}

export function cleanString(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}