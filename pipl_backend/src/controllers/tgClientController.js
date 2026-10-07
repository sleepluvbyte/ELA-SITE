import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { normalizeUsername, sendTelegramMessage } from '../services/telegramBot.js';

const CODE_TTL_MS = 10 * 60 * 1000;

// Приём сообщений от бота (webhook). Сохраняем связку username -> chat_id.
export async function webhook(req, res) {
  try {
    const update = req.body || {};
    const msg = update.message || update.channel_post || update.edited_message;
    if (msg && msg.from) {
      const username = normalizeUsername(msg.from.username);
      const chatId = msg.chat && msg.chat.id ? msg.chat.id : msg.from.id;
      if (username && chatId) {
        await db.query(
          `INSERT INTO tg_chats (username, chat_id, first_name, last_name, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (username) DO UPDATE
           SET chat_id = EXCLUDED.chat_id,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               updated_at = NOW()`,
          [username, chatId, msg.from.first_name || '', msg.from.last_name || '']
        );
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('webhook error:', error);
    res.json({ ok: true });
  }
}

// Клиент запрашивает одноразовый пароль в Telegram
export async function requestTgCode(req, res) {
  try {
    const username = normalizeUsername(req.body?.username);
    if (!username) {
      return res.status(400).json({ error: 'Укажите корректный ник в Telegram' });
    }

    const chat = await db.query('SELECT chat_id FROM tg_chats WHERE username = $1', [username]);
    if (chat.rows.length === 0) {
      return res.status(404).json({
        error: 'Мы ещё не видели вас в Telegram: откройте чат с ботом и нажмите /start',
        needStart: true,
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await db.query('DELETE FROM tg_login_codes WHERE username = $1', [username]);
    await db.query(
      'INSERT INTO tg_login_codes (username, code, expires_at) VALUES ($1, $2, $3)',
      [username, code, expiresAt]
    );

    const sent = await sendTelegramMessage(
      chat.rows[0].chat_id,
      `☕ <b>ПИПЛ: ваш код входа</b>\n\nКод: <code>${code}</code>\n\nОдноразовый, действует 10 минут. Никому его не сообщайте.`
    );

    if (!sent.ok) {
      return res.status(502).json({ error: 'Не удалось отправить код в Telegram' });
    }

    res.json({ message: 'Пароль отправлен в Telegram', username });
  } catch (error) {
    console.error('requestTgCode error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Клиент вводит присланный ботом пароль
export async function verifyTgCode(req, res) {
  try {
    const username = normalizeUsername(req.body?.username);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!username || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Неверный код или ник' });
    }

    const result = await db.query(
      `SELECT * FROM tg_login_codes
       WHERE username = $1 AND code = $2 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [username, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Неверный или истекший код' });
    }

    await db.query('DELETE FROM tg_login_codes WHERE username = $1', [username]);

    let user = await db.query('SELECT * FROM users WHERE tg_username = $1', [username]);
    if (user.rows.length === 0) {
      const newUser = await db.query(
        `INSERT INTO users (tg_username, role, name)
         VALUES ($1, 'client', $2)
         RETURNING id, tg_username, name, role`,
        [username, username]
      );
      user = newUser;
    }

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