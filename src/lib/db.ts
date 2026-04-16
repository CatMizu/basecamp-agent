import Database, { Database as BetterSqlite3Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { logger } from '../modules/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The migrations directory is copied to `./migrations` at the repo root in
 * dev, and to the same path relative to the container WORKDIR in prod (see
 * Dockerfile `COPY migrations ./migrations`).
 */
function migrationsDir(): string {
  // In dev (tsx) `__dirname` is .../src/lib. In prod it's .../dist/lib.
  // Both point to the same sibling-of-parent layout.
  return path.resolve(__dirname, '..', '..', 'migrations');
}

let _db: BetterSqlite3Database | undefined;

/**
 * Returns the singleton better-sqlite3 handle. better-sqlite3 is synchronous;
 * a single handle is safe to share across the whole process.
 */
export function getDb(): BetterSqlite3Database {
  if (_db) return _db;

  const dbPath = config.vaultDbPath;
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  _db = db;
  return db;
}

function runMigrations(db: BetterSqlite3Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    logger.warning('Migrations directory not found', { dir });
    return;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as Array<{ id: string }>).map((r) => r.id),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    logger.info('Applying migration', { file });
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(
        file,
        Math.floor(Date.now() / 1000),
      );
    });
    apply();
  }
}

/** For tests: closes the handle and clears the singleton. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

/**
 * For tests: point the singleton at a pre-built database. Pass `undefined`
 * to clear.
 */
export function setDbForTesting(db: BetterSqlite3Database | undefined): void {
  _db = db;
}

/** For tests: build an in-memory DB, apply the init migration, return it. */
export function createTestDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  const fs_ = fs;
  const migrationPath = path.resolve(migrationsDir(), '001_init.sql');
  const sql = fs_.readFileSync(migrationPath, 'utf8');
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  db.exec(sql);
  return db;
}
