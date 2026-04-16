#!/usr/bin/env tsx
/**
 * Dev helper: delete the vault DB and re-run migrations.
 * Usage: npm run dev-reset-db
 */
import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';
import { getDb } from '../src/lib/db.js';

const dbPath = path.resolve(config.vaultDbPath);
const wal = `${dbPath}-wal`;
const shm = `${dbPath}-shm`;

for (const p of [dbPath, wal, shm]) {
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`Deleted ${p}`);
  }
}

getDb();
console.log(`Re-initialized database at ${dbPath}`);
