import Database from 'better-sqlite3';
import { env } from '../config/env.js';

let db;

export function connectDb() {
  try {
    db = new Database(env.sqlitePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        firstName TEXT,
        lastName TEXT,
        phone TEXT,
        address TEXT,
        role TEXT,
        isActive INTEGER,
        createdAt TEXT,
        updatedAt TEXT
      )
    `);
    return true;
  } catch {
    return false;
  }
}

export function getDb() {
  return db;
}
