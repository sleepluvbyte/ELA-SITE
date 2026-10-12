import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = {
  query: (text, params) => pool.query(text, params),
  end: () => pool.end()
};

// Initialize database
export async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE,
      login VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'client',
      name VARCHAR(255),
      phone VARCHAR(50),
      beans_count INTEGER DEFAULT 0,
      total_spent DECIMAL(10,2) DEFAULT 0,
      qr_code TEXT,
      telegram_id BIGINT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(50) NOT NULL,
      beans_change INTEGER NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );
	
	CREATE TABLE IF NOT EXISTS banners (
	id SERIAL PRIMARY KEY,
	title VARCHAR(255),
	image_url TEXT NOT NULL,
	link_url TEXT,
	position INTEGER DEFAULT 1,
	active BOOLEAN DEFAULT true,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);

    CREATE TABLE IF NOT EXISTS tg_chats (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      chat_id BIGINT NOT NULL UNIQUE,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tg_login_codes (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username VARCHAR(64) UNIQUE;

    -- Вход клиента по номеру телефона: сайт шлёт deep-link
    -- t.me/<bot>?start=<phone>, бот привязывает номер к чату.
    -- username остаётся для старого входа по нику и поэтому становится
    -- необязательным; NULL в UNIQUE-колонке в PostgreSQL не конфликтует.
    ALTER TABLE tg_chats ALTER COLUMN username DROP NOT NULL;
    ALTER TABLE tg_chats ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    CREATE UNIQUE INDEX IF NOT EXISTS tg_chats_phone_uniq ON tg_chats (phone);
    ALTER TABLE tg_login_codes ALTER COLUMN username DROP NOT NULL;
    ALTER TABLE tg_login_codes ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    CREATE INDEX IF NOT EXISTS tg_login_codes_phone_idx ON tg_login_codes (phone);

    -- Афиша: события кофейни. Владелец редактирует из своего кабинета,
    -- публичная часть показывает только visible = true.
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      day VARCHAR(10),
      month VARCHAR(20),
      weekday VARCHAR(20),
      event_date DATE,
      visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✅ Database initialized');
}