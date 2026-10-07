import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './config/database.js';
import { createInitialAdmins, assertSecureConfig } from './controllers/authController.js';
import { authenticateToken, requireRole } from './middleware/auth.js';
import { uploadBannerImage, uploadsRoot } from './middleware/upload.js';
import { uploadBanner, updateBannerWithFile } from './controllers/bannerController.js';

import * as authController from './controllers/authController.js';
import * as telegramController from './controllers/telegramController.js';
import * as tgClientController from './controllers/tgClientController.js';
import * as clientController from './controllers/clientController.js';
import * as adminController from './controllers/adminController.js';
import * as ownerController from './controllers/ownerController.js';
import * as bannerController from './controllers/bannerController.js';
import { setWebhook } from './services/telegramBot.js';

dotenv.config();

const app = express();

// Express 5: бэкенд за Caddy (1 доверенный hop). Без этого express-rate-limit
// падает с ERR_ERL_UNEXPECTED_X_FORWARDED_FOR, т.к. X-Forwarded-For приходит от Caddy.
// В dev (прямое обращение) trust proxy не включает проброс от клиента.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

// Безопасные HTTP-заголовки (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // CSP включается через nginx/Caddy на уровне сайта
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 15552000, includeSubDomains: true },
  hidePoweredBy: true,
  crossOriginEmbedderPolicy: false
}));

// CORS: в production — только доверенные домены, в dev — всё открыто
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());
  app.use(cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(Object.assign(new Error('Not allowed by CORS'), { status: 403, code: 'CORS_DENIED' }));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
  }));
} else {
  app.use(cors());
}

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsRoot));

// Гарантируем наличие тела запроса (в Express 5 оно может быть undefined)
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
});

const ipKey = (req) => req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

// Общий лимит для всех запросов.
// 150 на IP было мало: в кофейне все гости выходят через один публичный адрес,
// и несколько активных клиентов плюс персонал выбирали квоту за 15 минут —
// сайт начинал отдавать 429 живому клиенту. 300 держит защиту от флуда
// (всего ~0.3 запроса в секунду) и даёт запас на обычную работу.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Слишком много запросов, попробуйте позже' }
});

app.use('/api', limiter);

// Общий backstop на /api/auth: считаем только неудачные попытки, чтобы
// успешный вход не тратил квоту. Раньше стояло max: 10 на IP — в кофейне
// персонал сидит за одним публичным IP, и десятая опечатка блокировала
// вход всем сразу. Теперь это грубая страховка, а не реальный порог.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Слишком много попыток, попробуйте позже' }
});

app.use('/api/auth', authLimiter);

// Защита от перебора пароля — по конкретной учётке, а не по IP.
// Один сотрудник не блокирует весь офис, но подобрать пароль не получится.
const loginKey = (req) => {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase() : '';
  return login ? `${login}|${ipKey(req)}` : ipKey(req);
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginKey,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут' }
});

// Лимит на отправку email-кодов. Ключ — email, а не IP: все гости кофейни
// выходят через один публичный адрес, и лимит по IP после трёх попыток
// блокировал бы вход всем остальным. Плюс отдельный общий потолок,
// чтобы один IP не слал тысячу писем с разных адресов.
const emailKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email || ipKey(req);
};

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  message: { error: 'Слишком много кодов на этот email, попробуйте через час' }
});

const emailIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Слишком много запросов, попробуйте позже' }
});

app.post('/api/auth/register', emailLimiter, emailIpLimiter, authController.registerClient);

// Auth routes
app.post('/api/auth/verify', authController.verifyCode);
// Успешный вход снимает счётчик неудач: человек, который пару раз промахнулся
// кириллицей в раскладке, не должен копить блокировку весь рабочий день.
// skipSuccessfulRequests лишь не увеличивает счётчик, но и не стирает
// накопленные неудачи — это делает resetKey. loginAdmin(req, res) не
// принимает next, поэтому цепляемся за res.json, а не за третий аргумент.
function loginWithReset(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) loginLimiter.resetKey(loginKey(req));
    return sendJson(body);
  };
  return authController.loginAdmin(req, res, next);
}

app.post('/api/auth/login', loginLimiter, loginWithReset);
app.post('/api/auth/telegram', telegramController.loginViaTelegram);
app.post('/api/auth/tg-request', tgClientController.requestTgCode);
app.post('/api/auth/tg-verify', tgClientController.verifyTgCode);

// Telegram bot webhook (клиентская авторизация)
app.post('/api/webhook/telegram', tgClientController.webhook);

// Client routes
app.get('/api/client/profile', authenticateToken, requireRole('client'), clientController.getProfileWithQR);
app.get('/api/client/qr', authenticateToken, requireRole('client'), clientController.getDynamicQR);
app.get('/api/client/news', authenticateToken, requireRole('client'), clientController.getNews);
app.post('/api/client/redeem', authenticateToken, requireRole('client'), clientController.redeemReward);

// Admin routes
app.post('/api/admin/scan', authenticateToken, requireRole('admin', 'owner'), adminController.scanQRCode);
app.post('/api/admin/redeem', authenticateToken, requireRole('admin', 'owner'), adminController.redeemByAdmin);
app.post('/api/admin/beans/add', authenticateToken, requireRole('admin', 'owner'), adminController.addBeans);
app.post('/api/admin/beans/deduct', authenticateToken, requireRole('admin', 'owner'), adminController.deductBeans);
app.get('/api/admin/clients', authenticateToken, requireRole('admin', 'owner'), adminController.getClients);
app.post('/api/admin/news', authenticateToken, requireRole('admin', 'owner'), adminController.createNews);
app.get(/api/admin/news, authenticateToken, requireRole(admin,owner), adminController.getAllNews);
app.put(/api/admin/news/:id, authenticateToken, requireRole(admin,owner), adminController.updateNews);
app.delete(/api/admin/news/:id, authenticateToken, requireRole(admin,owner), adminController.deleteNews);

// Owner routes
app.get('/api/owner/dashboard', authenticateToken, requireRole('owner'), ownerController.getDashboard);
app.get('/api/owner/analytics', authenticateToken, requireRole('owner'), ownerController.getAnalytics);
app.get('/api/owner/transactions', authenticateToken, requireRole('owner'), ownerController.getAllTransactions);
app.get('/api/owner/export', authenticateToken, requireRole('owner'), ownerController.exportData);

// Banner routes
app.get('/api/banners', bannerController.getBanners);
app.post('/api/admin/banners', authenticateToken, requireRole('admin', 'owner'), bannerController.createBanner);
app.put('/api/admin/banners/:id', authenticateToken, requireRole('admin', 'owner'), bannerController.updateBanner);
app.delete('/api/admin/banners/:id', authenticateToken, requireRole('admin', 'owner'), bannerController.deleteBanner);

// Banner routes с загрузкой файлов
app.post('/api/admin/banners/upload',
  authenticateToken,
  requireRole('admin', 'owner'),
  uploadBannerImage,
  uploadBanner
);

app.put('/api/admin/banners/:id/upload',
  authenticateToken,
  requireRole('admin', 'owner'),
  uploadBannerImage,
  updateBannerWithFile
);

// 404 для несуществующих API-маршрутов
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: 'Ошибка загрузки файла: ' + err.message });
  }
  if (err && err.status === 403) {
    const message = err.code === 'CORS_DENIED'
      ? 'Запрос с другого домена запрещён'
      : 'Доступ запрещён';
    return res.status(403).json({ error: message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    assertSecureConfig();

    await initDatabase();
    await createInitialAdmins();

    // Telegram — необязательная интеграция. Его недоступность не должна
    // ронять сайт: раньше сетевой сбой к api.telegram.org приводил к
    // process.exit(1) и сайт не поднимался вообще.
    if (process.env.TG_WEBHOOK_URL && process.env.TG_BOT_TOKEN) {
      try {
        const r = await setWebhook(process.env.TG_WEBHOOK_URL);
        if (r.ok) console.log('✅ Telegram webhook registered');
        else console.warn('⚠️ Telegram webhook не зарегистрирован:', r.reason || r.body?.description || 'unknown');
      } catch (error) {
        console.warn('⚠️ Telegram недоступен, продолжаю без него:', error.message);
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;