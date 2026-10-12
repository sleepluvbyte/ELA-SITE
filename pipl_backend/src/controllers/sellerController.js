import { db } from '../config/database.js';
import { cleanString } from '../utils/validate.js';
import * as adminController from './adminController.js';

// Номер гостя для карточки: id дополняем нулями до 4 знаков (#0042).
export function guestNumber(id) {
  return String(id).padStart(4, '0');
}

function withGuestNumber(row) {
  if (!row) return row;
  return { ...row, guest_number: guestNumber(row.id) };
}

// Продавец может либо отсканировать QR (qrData), либо найти гостя вручную
// по телефону / email / #номеру. QR уходит в общий обработчик админа,
// ручной ввод разбираем здесь.
export async function scanOrLookup(req, res) {
  try {
    const qrData = req.body?.qrData;
    if (typeof qrData === 'string' && qrData.trim()) {
      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        if (payload && payload.user) payload.user = withGuestNumber(payload.user);
        return originalJson(payload);
      };
      return adminController.scanQRCode(req, res);
    }

    const query = cleanString(req.body?.query, 254);
    if (!query) {
      return res.status(400).json({ error: 'Введите телефон, email или #номер' });
    }

    let result;
    if (query.includes('@')) {
      result = await db.query(
        'SELECT id, email, name, phone, beans_count, total_spent FROM users WHERE lower(email) = lower($1) AND role = $2',
        [query, 'client']
      );
    } else if (query.startsWith('#') || /^\d+$/.test(query)) {
      const id = parseInt(query.replace(/[^0-9]/g, ''), 10);
      result = await db.query(
        'SELECT id, email, name, phone, beans_count, total_spent FROM users WHERE id = $1 AND role = $2',
        [id, 'client']
      );
    } else {
      const digits = query.replace(/[^0-9]/g, '');
      result = await db.query(
        'SELECT id, email, name, phone, beans_count, total_spent FROM users WHERE regexp_replace(coalesce(phone, \'\'), \'[^0-9]\', \'\', \'g\') = $1 AND role = $2',
        [digits, 'client']
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Гость не найден' });
    }

    res.json({ user: withGuestNumber(result.rows[0]) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function addBeans(req, res) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && payload.user) payload.user = withGuestNumber(payload.user);
    return originalJson(payload);
  };
  return adminController.addBeans(req, res);
}

export async function redeem(req, res) {
  return adminController.redeemByAdmin(req, res);
}
