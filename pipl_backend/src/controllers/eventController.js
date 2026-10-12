import { db } from '../config/database.js';
import { toPositiveInt, cleanString } from '../utils/validate.js';

const SELECT_FIELDS = `
  id, title, description, day, month, weekday,
  to_char(event_date, 'YYYY-MM-DD') AS event_date, visible, created_at, updated_at
`;

function parseEventBody(body) {
  const title = cleanString(body.title, 255);
  const description = cleanString(body.description ?? body.desc, 5000);
  const day = cleanString(body.day, 10);
  const month = cleanString(body.month, 20);
  const weekday = cleanString(body.weekday, 20);

  const rawDate = cleanString(body.event_date ?? body.eventDate, 20);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const visible = body.visible === undefined ? true : Boolean(body.visible);

  return { title, description, day, month, weekday, eventDate, visible };
}

// Публичная афиша: только видимые события, ближайшие сверху.
export async function getPublicEvents(req, res) {
  try {
    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM events
       WHERE visible = true
       ORDER BY (event_date IS NULL), event_date ASC, id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Полный список для кабинета владельца.
export async function getAllEvents(req, res) {
  try {
    const result = await db.query(
      `SELECT ${SELECT_FIELDS}
       FROM events
       ORDER BY (event_date IS NULL), event_date ASC, id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function createEvent(req, res) {
  try {
    const e = parseEventBody(req.body);
    if (!e.title) return res.status(400).json({ error: 'Название обязательно' });
    if (!e.day || !e.month) return res.status(400).json({ error: 'Укажите день и месяц' });

    const result = await db.query(
      `INSERT INTO events (title, description, day, month, weekday, event_date, visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_FIELDS}`,
      [e.title, e.description, e.day, e.month, e.weekday, e.eventDate, e.visible]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function updateEvent(req, res) {
  try {
    const id = toPositiveInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный ID события' });

    const e = parseEventBody(req.body);
    if (!e.title) return res.status(400).json({ error: 'Название обязательно' });
    if (!e.day || !e.month) return res.status(400).json({ error: 'Укажите день и месяц' });

    const result = await db.query(
      `UPDATE events
       SET title = $1, description = $2, day = $3, month = $4, weekday = $5,
           event_date = $6, visible = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING ${SELECT_FIELDS}`,
      [e.title, e.description, e.day, e.month, e.weekday, e.eventDate, e.visible, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Событие не найдено' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function deleteEvent(req, res) {
  try {
    const id = toPositiveInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный ID события' });

    const result = await db.query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Событие не найдено' });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function toggleEventVisibility(req, res) {
  try {
    const id = toPositiveInt(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный ID события' });

    const result = await db.query(
      `UPDATE events
       SET visible = NOT visible, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING ${SELECT_FIELDS}`,
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Событие не найдено' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}
