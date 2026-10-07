import { db } from '../config/database.js';
import { upload, uploadsRoot } from '../middleware/upload.js';
import path from 'path';
import fs from 'fs';
import { cleanString } from '../utils/validate.js';

// Публичный URL вида /uploads/banners/x.jpg переводим в путь на диске и
// проверяем, что он не вылезает за пределы uploads: в image_url попадает
// строка из БД, которой могли записать что угодно через админку.
function resolveUploadPath(publicUrl) {
  const relative = String(publicUrl).replace(/^\/+/, '');
  const absolute = path.resolve(uploadsRoot, relative);
  const root = path.resolve(uploadsRoot) + path.sep;
  return absolute.startsWith(root) ? absolute : null;
}

function toBannerTitle(value) { return cleanString(value, 255); }
function toBannerUrl(value) { return cleanString(value, 1000); }
function toPosition(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 1;
} 

export async function getBanners(req, res) {
  try {
    const result = await db.query(
      `SELECT * FROM banners WHERE active = true ORDER BY position ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Загрузка баннера с файлом
export async function uploadBanner(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    const title = toBannerTitle(req.body.title);
    const link_url = toBannerUrl(req.body.link_url);
    const position = toPosition(req.body.position);
    const image_url = `/uploads/banners/${path.basename(req.file.path)}`;
    
    const result = await db.query(
      `INSERT INTO banners (title, image_url, link_url, position) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [title || 'Баннер', image_url, link_url || null, position]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Обновление баннера с файлом
export async function updateBannerWithFile(req, res) {
  try {
    const { id } = req.params;
    const title = toBannerTitle(req.body.title);
    const link_url = toBannerUrl(req.body.link_url);
    const position = toPosition(req.body.position);
    const active = req.body.active === 'false' || req.body.active === false ? false : true;
    
    let image_url = toBannerUrl(req.body.image_url);
    
    // Если загружен новый файл
    if (req.file) {
      image_url = `/uploads/banners/${path.basename(req.file.path)}`;
      
      // Удаляем старый файл если есть
      const oldBanner = await db.query('SELECT image_url FROM banners WHERE id = $1', [id]);
      if (oldBanner.rows.length > 0 && oldBanner.rows[0].image_url) {
        const oldPath = resolveUploadPath(oldBanner.rows[0].image_url);
        try {
          if (oldPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log(`🗑️ Старый файл удалён: ${oldPath}`);
          }
        } catch (err) {
          console.error('Ошибка удаления файла:', err);
        }
      }
    }
    
    const result = await db.query(
      `UPDATE banners 
       SET title = $1, image_url = COALESCE($2, image_url), link_url = $3, 
           position = $4, active = $5, updated_at = NOW() 
       WHERE id = $6 
       RETURNING *`,
      [title, image_url, link_url, position, active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Баннер не найден' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function createBanner(req, res) {
  try {
    const image_url = toBannerUrl(req.body.image_url);
    const title = toBannerTitle(req.body.title);
    const link_url = toBannerUrl(req.body.link_url);
    const position = toPosition(req.body.position);

    // Валидация
    if (!image_url) {
      return res.status(400).json({ error: 'URL изображения обязателен' });
    }

    const result = await db.query(
      `INSERT INTO banners (title, image_url, link_url, position) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [title || 'Баннер', image_url, link_url || null, position]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}


export async function updateBanner(req, res) {
  try {
    const { id } = req.params;
    const title = toBannerTitle(req.body.title);
    const image_url = toBannerUrl(req.body.image_url);
    const link_url = toBannerUrl(req.body.link_url);
    const position = toPosition(req.body.position);
    const active = req.body.active === undefined || req.body.active === true || req.body.active === 'true';
    const result = await db.query(
      `UPDATE banners 
       SET title = $1, image_url = $2, link_url = $3, position = $4, 
           active = $5, updated_at = NOW() 
       WHERE id = $6 
       RETURNING *`,
      [title, image_url, link_url, position, active, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Баннер не найден' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function deleteBanner(req, res) {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM banners WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}