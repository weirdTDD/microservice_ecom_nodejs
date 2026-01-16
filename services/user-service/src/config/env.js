// services/user-service/src/config/env.js
import process from 'process';

export const env = {
  port: process.env.PORT || 3004,
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  sqlitePath: process.env.SQLITE_PATH || './users.db',
};
