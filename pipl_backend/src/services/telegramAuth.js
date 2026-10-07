import crypto from 'crypto';

const MAX_TG_AUTH_AGE_MS = 300 * 1000;

export function parseInitData(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const result = {};
  raw.split('&').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  });
  return result;
}

export function buildCheckString(payload) {
  return Object.keys(payload)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join('\n');
}

export function verifyTelegramAuth(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'no_data' };
  }

  const hash = payload.hash;
  if (!hash) {
    return { ok: false, reason: 'no_hash' };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'bad_auth_date' };
  }

  const nowMs = Date.now();
  const authDateMs = authDate * 1000;
  if (nowMs - authDateMs > MAX_TG_AUTH_AGE_MS || authDateMs > nowMs + 60 * 1000) {
    return { ok: false, reason: 'auth_date_too_old' };
  }

  const token = process.env.TG_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: 'bot_not_configured' };
  }

  const dataCheckString = buildCheckString(payload);
  const secret = crypto.createHash('sha256').update(token).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (computed !== hash.toLowerCase()) {
    return { ok: false, reason: 'bad_signature' };
  }

  const id = Number(payload.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, reason: 'bad_id' };
  }

  return {
    ok: true,
    user: {
      id,
      first_name: payload.first_name || '',
      last_name: payload.last_name || '',
      username: payload.username || '',
      photo_url: payload.photo_url || '',
    },
  };
}

export function resolveRoleByTgId(tgId) {
  const ownerIds = (process.env.OWNER_TG_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  const adminIds = (process.env.ADMIN_TG_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ownerIds.includes(tgId)) return 'owner';
  if (adminIds.includes(tgId)) return 'admin';
  return null;
}