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

export function botUsername() {
  return (process.env.TG_BOT_USERNAME || '').replace(/^@/, '');
}

// Публичная ссылка входа: t.me/<bot>?start=<phone> подключает номер к чату.
export function botStartPrefix() {
  const name = botUsername();
  return name ? `https://t.me/${name}?start=` : '';
}

export function botStartUrl(payload) {
  return botStartPrefix() + encodeURIComponent(String(payload || ''));
}

export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  let u = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-zA-Z0-9_]{4,32}$/.test(u) ? u : '';
}

// Телефон приводим к международному виду без «+»: 79991234567.
// Короткие мобильные форматы (09991234567 и т.п.) не угадываем —
// принимаем только явные 10–15 цифр, иначе пользователь сам поправит.
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1);
  if (digits.length === 10) return '7' + digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return '';
}

export async function sendTelegramMessage(chatId, text, extra = {}) {
  return tgFetch('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

// Подтверждение нажатия на inline-кнопку: снимает «часики» у Telegram.
export async function answerCallback(callbackQueryId, text, showAlert = false) {
  return tgFetch('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  });
}

export async function setWebhook(url) {
  return tgFetch('setWebhook', { url, drop_pending_updates: true });
}
