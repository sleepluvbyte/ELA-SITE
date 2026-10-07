import QRCode from 'qrcode';
import { db } from '../config/database.js';
import crypto from 'crypto';

export async function getProfile(req, res) {
  try {
    const user = req.user;

    if (!user.qr_code) {
      const qrData = JSON.stringify({ userId: user.id, email: user.email });
      const qrCode = await QRCode.toDataURL(qrData);
      
      await db.query(
        'UPDATE users SET qr_code = $1 WHERE id = $2',
        [qrCode, user.id]
      );
      
      user.qr_code = qrCode;
    }

    const transactions = await db.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [user.id]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        beans_count: user.beans_count,
        qr_code: user.qr_code,
        total_spent: user.total_spent
      },
      transactions: transactions.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function getNews(req, res) {
  try {
    const result = await db.query(
      `SELECT n.*, u.name as author_name 
       FROM news n 
       LEFT JOIN users u ON n.created_by = u.id 
       ORDER BY n.published_at DESC 
       LIMIT 20`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function redeemReward(req, res) {
  try {
    const userId = req.user.id;
    const user = req.user;

    if (user.beans_count < 7) {
      return res.status(400).json({ 
        error: 'Недостаточно зёрен. Нужно 7, у вас: ' + user.beans_count 
      });
    }

    await db.query(
      'UPDATE users SET beans_count = beans_count - 7 WHERE id = $1',
      [userId]
    );

    await db.query(
      `INSERT INTO transactions (user_id, type, beans_change, description) 
       VALUES ($1, 'reward_redeem', -7, 'Бесплатный напиток')`,
      [userId]
    );

    res.json({
      success: true,
      message: '🎉 Поздравляем! Вы получили бесплатный напиток!'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}


// Генерация временного QR-кода (меняется каждые 30 сек)
export async function getDynamicQR(req, res) {
  try {
    const userId = req.user.id;
    const timestamp = Date.now();
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    
    // Создаём подпись для безопасности
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${userId}:${timestamp}`)
      .digest('hex')
      .slice(0, 16);
    
    const qrData = {
      userId,
      timestamp,
      signature,
      expiresAt: timestamp + 120000  // 120 секунд
    };
    
    const qrString = JSON.stringify(qrData);
    const qrCode = await QRCode.toDataURL(qrString, {
      width: 400,
      margin: 2,
      color: { dark: '#1E3A5F', light: '#FFFFFF' }
    });
    
    res.json({
      qrCode,
      qrData,
      expiresIn: 120  //  120
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка генерации QR' });
  }
}

// Получение профиля с QR
export async function getProfileWithQR(req, res) {
  try {
    const user = req.user;
    const transactions = await db.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [user.id]
    );
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        beans_count: user.beans_count,
        total_spent: user.total_spent
      },
      transactions: transactions.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}