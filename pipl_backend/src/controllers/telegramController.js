import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { parseInitData, verifyTelegramAuth, resolveRoleByTgId } from '../services/telegramAuth.js';

export async function loginViaTelegram(req, res) {
  try {
    const raw = typeof req.body.initData === 'string' ? req.body.initData : null;
    if (!raw) {
      return res.status(400).json({ error: 'Отсутствуют данные авторизации Telegram' });
    }

    const payload = parseInitData(raw);
    const verified = verifyTelegramAuth(payload);

    if (!verified.ok) {
      const code = verified.reason === 'bot_not_configured' ? 503 : 401;
      return res.status(code).json({ error: 'Telegram-авторизация не прошла проверку' });
    }

    const tgId = verified.user.id;
    const role = resolveRoleByTgId(tgId);

    if (!role) {
      return res.status(403).json({ error: 'Доступ запрещён: аккаунт не добавлен в whitelist персонала' });
    }

    const name = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ').trim() || 'Персонал';
    const username = verified.user.username || '';

    let result = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tgId]);

    if (result.rows.length === 0) {
      const created = await db.query(
        `INSERT INTO users (name, role, telegram_id, last_login)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (telegram_id) DO UPDATE SET last_login = NOW()
         RETURNING *`,
        [name, role, tgId]
      );
      result = created;
    }

    const user = result.rows[0];

    const existing = await db.query(
      'SELECT * FROM users WHERE id = $1 AND telegram_id = $2',
      [user.id, tgId]
    );
    if (existing.rows.length === 0) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    if (user.role !== role) {
      await db.query('UPDATE users SET role = $1, name = $2 WHERE id = $3', [role, name, user.id]);
      user.role = role;
      user.name = name;
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        login: user.login,
        telegram_id: user.telegram_id,
        username,
      },
    });
  } catch (error) {
    console.error('[telegram-auth]', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}