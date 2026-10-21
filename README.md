# ELA-SITE

Репозиторий сайта-кофейни «ПИПЛ.» (piplcoffee.ru). Репозиторий публичный, поэтому **никаких секретов**: пароли, токены и ключи лежат только в `.env` на сервере (в git попадает лишь шаблон `pipl_backend/.env.example`).

## Структура

```
pipl_backend/          серверная часть (Node.js / Express / PostgreSQL)
  src/app.js           точка входа, маршруты
  src/config/          БД, константы
  src/controllers/     auth / client / seller / owner / admin / events / tgClient / telegram
  src/services/        email (коды подтверждения), Telegram-бот
frontend/              фронтенд (новая вёрстка, деплоится на сервер)
  index.html           главная: вход гостя по email+коду, афиша, карусель фото
  owner.html           кабинет владельца: статистика, афиша (CRUD), экран логина
  jsQR.min.js          декодер QR для камеры (фолбэк для iOS/Safari без BarcodeDetector)
  logo.webp, photo1-6.webp
```

## Ссылки для персонала

| Ссылка                 | Кто             | Что открывает                                    |
|------------------------|-----------------|--------------------------------------------------|
| `https://piplcoffee.ru/barista` | бариста  | отдельная страница входа → кабинет сканера QR    |
| `https://piplcoffee.ru/owner`   | владелец | кабинет владельца (свой экран логина)             |

Вкладка «ПЕРСОНАЛ» из модалки входа гостя убрана. Старый `/personals` и `/staff.html` редиректят на `/barista`.

## Как это разложено на сервере (продакшен)

| Репозиторий                | Сервер /opt/pipl            |
|----------------------------|------------------------------|
| `pipl_backend/src/**`      | `backend/src/**`            |
| `frontend/*`               | `frontend/*`                |
| `pipl_backend/.env.example`| `backend/.env` (реальный!)  |

- На сервере backend крутится как systemd-сервис `pipl-api` (рабочая папка `/opt/pipl/backend`).
- Почта для кодов подтверждения и SMTP-ключи: `backend/.env` → `SMTP_*`, `EMAIL_FROM`; после правки `systemctl restart pipl-api`.
- Статика и прокси на `/api`/`/owner`/`/barista` — Caddy (`/etc/caddy/Caddyfile`).
- Аккаунты ролей задаются в `backend/.env`: `OWNER_LOGIN/OWNER_PASSWORD`, `SELLER_LOGIN/SELLER_PASSWORD`, `ADMIN_LOGIN/ADMIN_PASSWORD`.

## API (кратко)

Публичные: `POST /api/auth/request|verify`, `GET /api/public/events`.
По ролям (`Authorization: Bearer <jwt>`): `GET /api/auth/me`, `GET /api/client/profile`; продавец — `POST /api/seller/scan`, `/api/seller/beans/add|redeem`; владелец — `GET /api/owner/stats?period=week|month|year`, CRUD `/api/owner/events`.

## Деплой

Код на GitHub считается источником истины. Загрузка на сервер: копировать `frontend/*` → `/opt/pipl/frontend/`, `pipl_backend/src/*` → `/opt/pipl/backend/src/`, затем `systemctl restart pipl-api`. Серверный git-клон пока не может пушить (нет SSH-ключа) — после настройки ключа синхронизировать через `git fetch && git reset --hard origin/master`.

## Прочее в рабочей папке

В этой же рабочей папке находятся несвязанные личные проекты (ELA_CASH, скрипты на Python и т.п.) — они в git не включаются намеренно.