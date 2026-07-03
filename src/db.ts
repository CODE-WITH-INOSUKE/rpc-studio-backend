import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(__dirname, '..', 'data', 'rpc.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      discord_created_at TEXT,
      bio TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      status_message TEXT DEFAULT '',
      status_emoji TEXT DEFAULT '',
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT DEFAULT 'Bearer',
      token_expires_at INTEGER,
      connected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rich_presences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      type TEXT DEFAULT 'PLAYING',
      state TEXT,
      details TEXT,
      large_image TEXT,
      large_text TEXT,
      small_image TEXT,
      small_text TEXT,
      party_current INTEGER,
      party_max INTEGER,
      start_timestamp INTEGER,
      end_timestamp INTEGER,
      button1_name TEXT,
      button1_url TEXT,
      button2_name TEXT,
      button2_url TEXT,
      platform TEXT DEFAULT 'desktop',
      application_id TEXT,
      url TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spotify_presences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      song_id TEXT,
      album_id TEXT,
      artist_ids TEXT DEFAULT '[]',
      song_name TEXT,
      album_name TEXT,
      artists TEXT,
      large_image TEXT,
      small_image TEXT,
      start_timestamp INTEGER,
      end_timestamp INTEGER,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      emoji TEXT,
      state TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fake_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      executable TEXT NOT NULL DEFAULT '',
      is_running INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS detectable_games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      executables TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  const migrations = [
    `ALTER TABLE rich_presences ADD COLUMN updated_at TEXT DEFAULT ''`,
    `ALTER TABLE spotify_presences ADD COLUMN updated_at TEXT DEFAULT ''`,
    `ALTER TABLE custom_statuses ADD COLUMN updated_at TEXT DEFAULT ''`,
    `ALTER TABLE fake_games ADD COLUMN updated_at TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN status_emoji TEXT DEFAULT ''`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column may already exist */ }
  }
}
