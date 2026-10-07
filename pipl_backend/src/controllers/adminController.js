import { db } from '../config/database.js';
import crypto from 'crypto';
import { toPositiveInt, toUserId, cleanString } from '../utils/validate.js';

export async function scanQRCode(req, res) {
  try {
    const { qrData } = req.body;
    
    if (typeof qrData !== 'string' || qrData.length > 512) {
      return res.status(400).json({ error: 'Неверный формат QR-кода' });
    }

    let data;
    try {
      data = JSON.parse(qrData);
    } catch {
      return res.status(400).json({ error: 'Неверный формат QR-кода' });
    }

    const userId = toUserId(data.userId);
    if (
      userId === null ||
      typeof data.timestamp !== 'number' ||
      typeof data.signature !== 'string' ||
      data.signature.length !== 16 ||
      typeof data.expiresAt !== 'number'
    ) {
      return res.status(400).json({ error: 'Недействительный QR-код' });
    }

    // Проверяем подпись и время
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${data.userId}:${data.timestamp}`)
      .digest('hex')
      .slice(0, 16);

    if (data.signature !== expectedSignature) {
      return res.status(400).json({ error: 'Недействительный QR-код' });
    }

    if (!Number.isFinite(data.expiresAt) || Date.now() > data.expiresAt) {
      return res.status(400).json({ error: 'QR-код истёк. Попросите клиента обновить' });
    }
    
    const result = await db.query(
      'SELECT id, email, name, beans_count, phone FROM users WHERE id = $1 AND role = $2',
      [userId, 'client']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Списание 7 зёрен администратором
export async function redeemByAdmin(req, res) {
  try {
    const userId = toUserId(req.body.userId);
    if (userId === null) {
      return res.status(400).json({ error: 'Некорректный ID клиента' });
    }
    const adminId = req.user.id;
    
    const user = await db.query('SELECT beans_count FROM users WHERE id = $1', [userId]);
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }
    
    if (user.rows[0].beans_count < 7) {
      return res.status(400).json({ 
        error: `Недостаточно зёрен. У клиента: ${user.rows[0].beans_count}` 
      });
    }
    
    await db.query(
      'UPDATE users SET beans_count = beans_count - 7 WHERE id = $1',
      [userId]
    );
    
    await db.query(
      `INSERT INTO transactions (user_id, type, beans_change, description, created_by) 
       VALUES ($1, 'admin_redeem', -7, 'Бесплатный напиток (через админа)', $2)`,
      [userId, adminId]
    );
    
    res.json({ success: true, message: '✅ 7 зёрен списано. Клиент получает бесплатный напиток!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function addBeans(req, res) {
  try {
    const userId = toUserId(req.body.userId);
    const beans = toPositiveInt(req.body.beans, 100);
    if (userId === null) return res.status(400).json({ error: 'Некорректный ID клиента' });
    if (beans === null) return res.status(400).json({ error: 'Количество зёрен должно быть целым числом от 1 до 100' });

    const description = cleanString(req.body.description, 500) || 'Начислено администратором';
    const adminId = req.user.id;

    await db.query(
      'UPDATE users SET beans_count = beans_count + $1 WHERE id = $2',
      [beans, userId]
    );

    await db.query(
      `INSERT INTO transactions (user_id, type, beans_change, description, created_by) 
       VALUES ($1, 'admin_add', $2, $3, $4)`,
      [userId, beans, description, adminId]
    );

    res.json({ success: true, message: `Начислено ${beans} зёрен` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function deductBeans(req, res) {
  try {
    const userId = toUserId(req.body.userId);
    const beans = toPositiveInt(req.body.beans, 100);
    if (userId === null) return res.status(400).json({ error: 'Некорректный ID клиента' });
    if (beans === null) return res.status(400).json({ error: 'Количество зёрен должно быть целым числом от 1 до 100' });

    const description = cleanString(req.body.description, 500) || 'Списано администратором';
    const adminId = req.user.id;

    const user = await db.query('SELECT beans_count FROM users WHERE id = $1', [userId]);
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Клиент не найден' });
    }

    if (user.rows[0].beans_count < beans) {
      return res.status(400).json({ error: 'Недостаточно зёрен у клиента' });
    }

    await db.query(
      'UPDATE users SET beans_count = beans_count - $1 WHERE id = $2',
      [beans, userId]
    );

    await db.query(
      `INSERT INTO transactions (user_id, type, beans_change, description, created_by) 
       VALUES ($1, 'admin_deduct', $2, $3, $4)`,
      [userId, -beans, description, adminId]
    );

    res.json({ success: true, message: `Списано ${beans} зёрен` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function getClients(req, res) {
  try {
    const result = await db.query(
      `SELECT id, email, name, phone, beans_count, total_spent, created_at, last_login 
       FROM users 
       WHERE role = 'client' 
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function createNews(req, res) {
  try {
    const title = cleanString(req.body.title, 255);
    const content = cleanString(req.body.content, 5000);
    const image_url = cleanString(req.body.image_url, 1000);
    const adminId = req.user.id;

    if (!title) return res.status(400).json({ error: 'Заголовок обязателен' });
    if (!content) return res.status(400).json({ error: 'Текст новости обязателен' });

    const result = await db.query(
      `INSERT INTO news (title, content, image_url, created_by) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [title, content, image_url || null, adminId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}