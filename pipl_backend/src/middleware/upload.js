import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Путь считаем от файла модуля, а не от текущего каталога: иначе загрузки
// уезжают в произвольное место при запуске не из корня backend.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const uploadsRoot = path.join(backendRoot, 'uploads');

const uploadDir = path.join(uploadsRoot, 'banners');
fs.mkdirSync(uploadDir, { recursive: true });

// Content-Type и originalname приходят от клиента, им нельзя доверять:
// расширение выводим из MIME-типа, а не из имени файла.
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

// Байтовые сигнатуры реального содержимого файла.
const MAGIC_SIGNATURES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
};

function hasImageSignature(buffer, mimetype) {
  if (mimetype === 'image/webp') {
    return buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  const signature = MAGIC_SIGNATURES[mimetype];
  if (!signature || buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'banner-' + uniqueSuffix + MIME_EXTENSIONS[file.mimetype]);
  }
});

const fileFilter = (req, file, cb) => {
  if (!MIME_EXTENSIONS[file.mimetype]) {
    return cb(new Error('Только изображения (JPG, PNG, WebP)'));
  }
  cb(null, true);
};

export const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: fileFilter
});

// Сверяем сигнатуру уже записанного файла: polyglot с валидным Content-Type сюда не пройдёт.
async function verifyImageSignature(req, res, next) {
  if (!req.file) return next();

  let handle;
  try {
    handle = await fs.promises.open(req.file.path, 'r');
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);

    if (!hasImageSignature(head.subarray(0, bytesRead), req.file.mimetype)) {
      await handle.close();
      await fs.promises.unlink(req.file.path);
      return next(Object.assign(new Error('Файл не является изображением'), { status: 400 }));
    }

    await handle.close();
    next();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    next(error);
  }
}

export const uploadBannerImage = [upload.single('image'), verifyImageSignature];
