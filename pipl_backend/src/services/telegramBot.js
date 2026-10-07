const TG_API = 'https://api.telegram.org';
// Telegram из России периодически недоступен, а запрос без таймаута висит
// до обрыва соединения. Ограничиваем каждую попытку.
const TG_TIMEOUT_MS = 8000;

async function tgFetch(method, payload) {
  const token = botToken();
  if (!token) return { ok: false, reason: 'bot_not_configured' };
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TG_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, body };
  } catch (error) {
    return { ok: false, reason: 'unreachable', error: error.message };
  }
}

function botToken() {
  return process.env.TG_BOT_TOKEN || '';
}

export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  let u = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-zA-Z0-9_]{4,32}$/.test(u) ? u : '';
}

export async function sendTelegramMessage(chatId, text) {
  return tgFetch('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

export async function setWebhook(url) {
  return tgFetch('setWebhook', { url, drop_pending_updates: true });
}