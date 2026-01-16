import bcrypt from 'bcrypt';
import { getDb } from '../db/sqlite.js';
import { memoryDb } from '../db/memory.js';

/**
 * INTERNAL helpers
 */
function rowToUser(row) {
  if (!row) return null;
  return {
    ...row,
    isActive: Boolean(row.isActive),
    address: row.address ? JSON.parse(row.address) : null,
  };
}

function now() {
  return new Date().toISOString();
}

/**
 * MODEL API (mirrors Mongoose behavior)
 */

export async function findUserById(userId) {
  const db = getDb();

  if (db) {
    return rowToUser(
      db
        .prepare(`SELECT * FROM users WHERE userId=? AND isActive=1`)
        .get(userId)
    );
  }

  for (const user of memoryDb.users.values()) {
    if (user.userId === userId) {
      return user.isActive ? user : null;
    }
  }

  return null;
}

export async function findUserByEmail(email) {
  const db = getDb();

  if (db) {
    return rowToUser(
      db
        .prepare(`SELECT * FROM users WHERE email=? AND isActive=1`)
        .get(email)
    );
  }

  for (const user of memoryDb.users.values()) {
    if (user.email === email) {
      return user.isActive ? user : null;
    }
  }

  return null;
}

export async function listUsers(query = {}) {
  const db = getDb();

  if (db) {
    return db
      .prepare(`SELECT * FROM users`)
      .all()
      .map(rowToUser);
  }

  return [...memoryDb.users.values()];
}

export async function countDocuments() {
  const db = getDb();
  return db
    ? db.prepare(`SELECT COUNT(*) as c FROM users`).get().c
    : memoryDb.users.size;
}

export async function createUser(data) {
  const user = {
    ...data,
    password: await bcrypt.hash(data.password, 10),
    role: data.role || 'customer',
    isActive: true,
    address: JSON.stringify(data.address || {}),
    createdAt: now(),
    updatedAt: now(),
  };

  const db = getDb();
  if (db) {
    db.prepare(`
      INSERT INTO users VALUES (
        @userId,@email,@password,@firstName,@lastName,
        @phone,@address,@role,1,@createdAt,@updatedAt
      )
    `).run(user);
  } else {
    memoryDb.users.set(user.userId, user);
  }

  return attachMethods(user);
}

export async function save(user) {
  user.updatedAt = now();

  const db = getDb();
  if (db) {
    db.prepare(`
      UPDATE users SET
        email=@email,
        password=@password,
        firstName=@firstName,
        lastName=@lastName,
        phone=@phone,
        address=@address,
        role=@role,
        isActive=@isActive,
        updatedAt=@updatedAt
      WHERE userId=@userId
    `).run({
      ...user,
      address: JSON.stringify(user.address),
      isActive: user.isActive ? 1 : 0,
    });
  } else {
    memoryDb.users.set(user.userId, user);
  }

  return attachMethods(user);
}

/**
 * Instance-like methods (Mongoose style)
 */
function attachMethods(user) {
  user.comparePassword = async (candidate) =>
    bcrypt.compare(candidate, user.password);
  return user;
}
