import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import {
  normalizeUsername,
  normalizePhone,
  sendTelegramMessage,
  answerCallback,
  botStartUrl,
} from '../services/telegramBot.js';

const CODE_TTL_MS = 10 * 60 * 1000;
// Антифлуд: один номер — не чаще одного кода в минуту, иначе кто-то,
// знающий чужой номер, заставит бота сыпать сообщения жертве.
const RESEND_COOLDOWN_MS = 60 * 1000;

const GET_CODE_BUTTON = { text: '🔑 ПОЛУЧИТЬ КОД', callback_data: 'getcode' };

const COOLDOWN_SQL = `created_at > NOW() - make_interval(secs => ${RESEND_COOLDOWN_MS / 1000})`;

// Учётная запись клиента ищется по телефону (основной вход),
// а при старом входе по нику — по tg_username.
async function findOrCreateUser({ phone, username }) {
  if (phone) {
    const existing = await db.query('SELECT * FROM users WHERE phone = $1 ORDER BY id LIMIT 1', [phone]);
    if (existing.rows.length) {
      await attachTelegram(existing.rows[0].id, phone);
      return existing;
    }

    const chat = await db.query(
      'SELECT chat_id, username, first_name, last_name FROM tg_chats WHERE phone = $1',
      [phone]
    );
    const c = chat.rows[0] || {};
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || null;

    return db.query(
      `INSERT INTO users (phone, name, role, tg_username, telegram_id)
       VALUES ($1, $2, 'client', $3, $4)
       RETURNING *`,
      [phone, name, username || c.username || null, c.chat_id || null]
    );
  }

  const legacy = await db.query('SELECT * FROM users WHERE tg_username = $1', [username]);
  if (legacy.rows.length) return legacy;

  return db.query(
    `INSERT INTO users (tg_username, role, name) VALUES ($1, 'client', $1) RETURNING *`,
    [username]
  );
}

// Привязываем telegram_id/username к уже существующему аккаунту, но только
// если этот telegram_id ещё никому не принадлежит — иначе уникальный
// индекс выстрелил бы 500-м на входе.
async function attachTelegram(userId, phone) {
  const chat = await db.query(
    'SELECT chat_id, username FROM tg_chats WHERE phone = $1',
    [phone]
  );
  const c = chat.rows[0];
  if (!c) return;

  const taken = await db.query(
    'SELECT id FROM users WHERE telegram_id = $1 AND id <> $2',
    [c.chat_id, userId]
  );
  if (taken.rows.length) return;

  await db.query(
    `UPDATE users
     SET telegram_id = $1, tg_username = COALESCE(tg_username, $2)
     WHERE id = $3`,
    [c.chat_id, c.username, userId]
  );
}

// Записываем связку ник -> chat_id при любом входящем сообщении.
async function touchChat({ chatId, username, firstName, lastName }) {
  if (!chatId) return;

  const existing = await db.query('SELECT id FROM tg_chats WHERE chat_id = $1', [chatId]);
  if (existing.rows.length) {
    await db.query(
      `UPDATE tg_chats
       SET username = COALESCE($1, username), first_name = $2, last_name = $3, updated_at = NOW()
       WHERE chat_id = $4`,
      [username, firstName, lastName, chatId]
    );
    return;
  }

  if (!username) return;
  await db.query(
    `INSERT INTO tg_chats (username, chat_id, first_name, last_name, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (username) DO UPDATE
     SET chat_id = EXCLUDED.chat_id,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         updated_at = NOW()`,
    [username, chatId, firstName, lastName]
  );
}

// Номер закрепляем за текущим чатом: он переезжает с прежнего чата,
// если был привязан к другому.
async function linkPhone({ chatId, phone, username, firstName, lastName }) {
  if (!chatId || !phone) return;
  await db.query('DELETE FROM tg_chats WHERE phone = $1 AND chat_id <> $2', [phone, chatId]);

  const existing = await db.query('SELECT id FROM tg_chats WHERE chat_id = $1', [chatId]);
  if (existing.rows.length) {
    await db.query(
      `UPDATE tg_chats
       SET phone = $1, username = COALESCE($2, username), first_name = $3, last_name = $4, updated_at = NOW()
       WHERE chat_id = $5`,
      [phone, username, firstName, lastName, chatId]
    );
    return;
  }

  await db.query(
    `INSERT INTO tg_chats (username, chat_id, phone, first_name, last_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (chat_id) DO UPDATE
     SET phone = EXCLUDED.phone,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         updated_at = NOW()`,
    [username, chatId, phone, firstName, lastName]
  );
}

// Общий путь выдачи кода: из сайта (tg-request) и из inline-кнопки бота.
// Код всегда уходит в тот же чат, что и привязка, — иначе его мог бы
// запросить любой, кто знает только номер.
async function issueCode({ phone, username }) {
  const usePhone = Boolean(phone);
  const key = phone || username;
  if (!key) return { ok: false, status: 400, error: 'Номер не привязан к боту' };

  const where = usePhone ? 'phone = $1' : 'username = $1';

  const cooled = await db.query(
    `SELECT id FROM tg_login_codes WHERE ${where} AND ${COOLDOWN_SQL} LIMIT 1`,
    [key]
  );
  if (cooled.rows.length) {
    return { ok: false, status: 429, error: 'Код уже отправлен. Подождите минуту' };
  }

  const chat = await db.query(`SELECT chat_id FROM tg_chats WHERE ${where}`, [key]);
  if (!chat.rows.length) {
    return {
      ok: false,
      status: 404,
      error: 'Мы ещё не видели вас в Telegram',
      needStart: true,
      botUrl: botStartUrl(key),
    };
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db.query(`DELETE FROM tg_login_codes WHERE ${where}`, [key]);
  await db.query(
    'INSERT INTO tg_login_codes (username, phone, code, expires_at) VALUES ($1, $2, $3, $4)',
    [username || null, phone || null, code, expiresAt]
  );

  const sent = await sendTelegramMessage(
    chat.rows[0].chat_id,
    `☕ <b>ПИПЛ: ваш код входа</b>\n\nКод: <code>${code}</code>\n\nОдноразовый, действует 10 минут. Никому его не сообщайте.`
  );
  if (!sent.ok) {
    return { ok: false, status: 502, error: 'Не удалось отправить код в Telegram' };
  }

  return { ok: true };
}

// Приём обновлений от бота: обычные сообщения и нажатия на inline-кнопку.
export async function webhook(req, res) {
  try {
    const update = req.body || {};

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return res.json({ ok: true });
    }

    const msg = update.message || update.channel_post || update.edited_message;
    if (msg && msg.from && !msg.from.is_bot) {
      await handleMessage(msg);
    }

    res.json({ ok: true });
  } catch (error) {
    // Ответим Telegram 200-м в любом случае, иначе он будет слать
    // апдейт снова и снова, пока не отключит вебхук.
    console.error('webhook error:', error);
    res.json({ ok: true });
  }
}

async function handleMessage(msg) {
  const chatId = (msg.chat && msg.chat.id) || msg.from.id;
  const username = normalizeUsername(msg.from.username);
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const parts = text.split(/\s+/);
  const isStart = parts[0] === '/start' || (parts[0] || '').startsWith('/start@');

  if (isStart) {
    const phone = normalizePhone(parts[1] || '');
    if (phone) {
      await linkPhone({ chatId, phone, username, firstName, lastName });
      await sendTelegramMessage(
        chatId,
        `✅ Номер ${phone} привязан к боту.\n\nНажмите кнопку ниже — пришлём код, а затем вставьте его на сайте.`,
        { reply_markup: { inline_keyboard: [[GET_CODE_BUTTON]] } }
      );
      return;
    }
  }

  await touchChat({ chatId, username, firstName, lastName });

  if (isStart) {
    const known = await db.query('SELECT phone FROM tg_chats WHERE chat_id = $1', [chatId]);
    if (known.rows[0] && known.rows[0].phone) {
      await sendTelegramMessage(chatId, 'Нажмите кнопку, чтобы получить код входа.', {
        reply_markup: { inline_keyboard: [[GET_CODE_BUTTON]] },
      });
    } else {
      await sendTelegramMessage(
        chatId,
        'Чтобы войти на сайт, вернитесь на него и нажмите «Войти» — там появится ссылка, привязывающая ваш номер к боту.'
      );
    }
  }
}

async function handleCallbackQuery(cb) {
  const data = cb.data || '';
  const chatId = (cb.message && cb.message.chat && cb.message.chat.id) || (cb.from && cb.from.id);

  if (data !== 'getcode') {
    await answerCallback(cb.id, 'Неизвестное действие');
    return;
  }

  const known = await db.query('SELECT phone FROM tg_chats WHERE chat_id = $1', [chatId]);
  const phone = known.rows[0] && known.rows[0].phone;
  if (!phone) {
    await answerCallback(cb.id, 'Номер не привязан: откройте ссылку с сайта', true);
    return;
  }

  await answerCallback(cb.id, 'Отправляем…');
  const result = await issueCode({ phone });
  if (!result.ok) {
    await sendTelegramMessage(chatId, `${result.error}.`);
  }
}

// Клиент просит выслать код (кнопка на сайте).
export async function requestTgCode(req, res) {
  try {
    const phone = normalizePhone(req.body?.phone);
    const username = phone ? '' : normalizeUsername(req.body?.username);
    if (!phone && !username) {
      return res.status(400).json({ error: 'Укажите номер телефона' });
    }

    const result = await issueCode({ phone: phone || null, username: username || null });
    if (!result.ok) {
      return res.status(result.status || 500).json({
        error: result.error,
        needStart: Boolean(result.needStart),
        botUrl: result.botUrl || botStartUrl(phone || username),
      });
    }

    res.json({ message: 'Код отправлен в Telegram', phone: phone || null });
  } catch (error) {
    console.error('requestTgCode error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Клиент вводит присланный ботом код.
export async function verifyTgCode(req, res) {
  try {
    const phone = normalizePhone(req.body?.phone);
    const username = phone ? '' : normalizeUsername(req.body?.username);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if ((!phone && !username) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Неверный код' });
    }

    const where = phone ? 'phone = $1' : 'username = $1';
    const key = phone || username;

    const found = await db.query(
      `SELECT id FROM tg_login_codes
       WHERE ${where} AND code = $2 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [key, code]
    );
    if (!found.rows.length) {
      return res.status(400).json({ error: 'Неверный или истекший код' });
    }

    await db.query(`DELETE FROM tg_login_codes WHERE ${where}`, [key]);

    const user = await findOrCreateUser({ phone, username });

    const token = jwt.sign(
      { userId: user.rows[0].id, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.rows[0].id]);

    res.json({ token, user: user.rows[0] });
  } catch (error) {
    console.error('verifyTgCode error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}
