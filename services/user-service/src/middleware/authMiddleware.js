import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { findUserById } from '../models/userModels.js';

/**
 * Authenticates user via Bearer JWT
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token' });
    }

    const token = header.replace('Bearer ', '');
    const decoded = jwt.verify(token, env.jwtSecret);

    const user = await findUserById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}

/**
 * Role-based authorization
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, error: 'Forbidden' });
    }
    next();
  };
}
