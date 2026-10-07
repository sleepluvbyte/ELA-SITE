import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { sendVerificationCode } from '../services/emailService.js';
import { isValidEmail, cleanString } from '../utils/validate.js';

const DEFAULT_JWT_SECRET = 'your_super_secret_key_change_this_in_production';

export function assertSecureConfig() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
      throw new Error('JWT_SECRET must be set and changed in production');
    }
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123') {
      throw new Error('ADMIN_PASSWORD must be changed in production');
    }
    if (!process.env.OWNER_PASSWORD || process.env.OWNER_PASSWORD === 'owner123') {
      throw new Error('OWNER_PASSWORD must be changed in production');
    }
  }
}

export async function registerClient(req, res) {
  try {
    const email = cleanString(req.body.email, 254).toLowerCase();
    const name = cleanString(req.body.name, 100);
    const phone = cleanString(req.body.phone, 50);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Некорректный email' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Очищаем старые коды
    await db.query('DELETE FROM verification_codes WHERE email = $1', [email]);
    
    // Сохраняем новый код
    await db.query(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] verification code sent for ${email}`);
    }

    const sent = await sendVerificationCode(email, code);
    if (!sent) {
      console.error(`[register] не удалось отправить код на ${email}`);
      return res.status(503).json({
        error: 'Не удалось отправить код на email. Попробуйте позже.'
      });
    }

    res.json({ 
      message: 'Код отправлен на email',
      email 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function verifyCode(req, res) {
  try {
    const email = cleanString(req.body.email, 254).toLowerCase();
    const code = cleanString(req.body.code, 6);

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Неверный или истекший код' });
    }

    if (process.env.NODE_ENV !== 'production') {
      const demoCode = process.env.DEMO_CODE || '123456';
      if (code === demoCode) {
        const existing = await db.query('SELECT id FROM verification_codes WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
          let user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
          if (user.rows.length === 0) {
            const newUser = await db.query(
              `INSERT INTO users (email, role, name) 
               VALUES ($1, 'client', $2) 
               RETURNING id, email, name, role`,
              [email, email.split('@')[0]]
            );
            user = newUser;
          }

          const token = jwt.sign(
            { userId: user.rows[0].id, role: user.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
          );

          await db.query('DELETE FROM verification_codes WHERE email = $1', [email]);
          await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.rows[0].id]);

          return res.json({ token, user: user.rows[0] });
        }
      }
    }

    const result = await db.query(
      `SELECT * FROM verification_codes 
       WHERE email = $1 AND code = $2 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Неверный или истекший код' });
    }

    await db.query('DELETE FROM verification_codes WHERE email = $1', [email]);

    let user = await db.query('SELECT * FROM users WHERE email = $1', [email]);

    if (user.rows.length === 0) {
      const newUser = await db.query(
        `INSERT INTO users (email, role, name) 
         VALUES ($1, 'client', $2) 
         RETURNING id, email, name, role`,
        [email, email.split('@')[0]]
      );
      user = newUser;
    }

    const token = jwt.sign(
      { userId: user.rows[0].id, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.rows[0].id]
    );

    res.json({
      token,
      user: user.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function loginAdmin(req, res) {
  try {
    const login = typeof req.body.login === 'string' ? req.body.login.trim().slice(0, 255) : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!login || !password || password.length > 255) {
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE login = $1 AND role IN ($2, $3)',
      [login, 'admin', 'owner']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    res.json({
      token,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function createInitialAdmins() {
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  const ownerPassword = await bcrypt.hash(process.env.OWNER_PASSWORD, 10);

  await db.query(`
    INSERT INTO users (login, password, name, role)
    VALUES ($1, $2, 'Администратор', 'admin')
    ON CONFLICT (login) DO NOTHING
  `, [process.env.ADMIN_LOGIN, adminPassword]);

  await db.query(`
    INSERT INTO users (login, password, name, role)
    VALUES ($1, $2, 'Владелец', 'owner')
    ON CONFLICT (login) DO NOTHING
  `, [process.env.OWNER_LOGIN, ownerPassword]);

  console.log('✅ Initial admins created');
}