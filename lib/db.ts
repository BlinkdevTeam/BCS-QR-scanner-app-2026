import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function createDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('attendance-scanner.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS participants_cache (
      id TEXT PRIMARY KEY NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      email TEXT,
      ticket_token TEXT NOT NULL UNIQUE,
      reg_status TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_scans (
      local_id TEXT PRIMARY KEY NOT NULL,
      participant_id TEXT NOT NULL,
      scanned_by TEXT NOT NULL,
      scanned_at TEXT NOT NULL,
      device_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_log_cache (
      id TEXT PRIMARY KEY NOT NULL,
      participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      participant_email TEXT,
      scanned_by TEXT NOT NULL,
      scanner_name TEXT,
      scanned_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration: older installs already created scan_log_cache without this
  // column. ALTER fails harmlessly if it's already there.
  try {
    await db.execAsync(`ALTER TABLE scan_log_cache ADD COLUMN participant_email TEXT;`);
  } catch {
    // column already exists — nothing to do
  }

  return db;
}

// Every caller — regardless of whether it asks via getDb() or initDb() —
// awaits this SAME cached promise. That's what prevents the race condition
// where one part of the app queries a table before another part has
// finished creating it.
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = createDb();
  }
  return dbPromise;
}

export async function initDb() {
  return getDb();
}