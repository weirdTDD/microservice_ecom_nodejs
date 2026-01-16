// src/controllers/user.controller.js
import jwt from 'jsonwebtoken';
import {
  createUser,
  findUserByEmail,
  findUserById,
  listUsers,
} from '../models/userModels.js';
import { env } from '../config/env.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { error } from 'console';

/**
 * POST /api/users/register
 */
export async function register(req, res) {
  try {
    const { email, password, firstName, lastName, phone, address } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    if (await findUserByEmail(email)) {
      return res.status(409).json({ success: false, error: 'Email exists' });
    }

    // Use the data structure that createUser expects
    const userData = {
      userId: `USER-${crypto.randomUUID()}`,
      email,
      password,  // Don't hash here, createUser will do it
      firstName,
      lastName,
      phone: phone || null,
      address: address || {},  // Don't stringify here, createUser will do it
      role: 'customer',
    };

    // createUser will hash the password and stringify the address
    const newUser = await createUser(userData);

    res.status(201).json({
      success: true,
      user: {
        userId: newUser.userId,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/users/login
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false });
    }

    const token = jwt.sign(
      { userId: user.userId, role: user.role },
      env.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
}

/**
 * GET /api/users/profile
 */
export async function getProfile(req, res) {
  const user = await findUserById(req.user.userId);
  delete user.password;
  res.json({ success: true, user });
}

/**
 * PUT /api/users/profile
 */
export async function updateProfile(req, res) {
  const user = await findUserById(req.user.userId);

  const { firstName, lastName, phone, address } = req.body;

  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (phone) user.phone = phone;
  if (address) user.address = JSON.stringify(address);

  user.updatedAt = new Date().toISOString();
await save(user);

  res.json({ success: true });
}

/**
 * GET /api/users/:userId
 */
export async function getUserById(req, res) {
  if (
    req.user.userId !== req.params.userId &&
    req.user.role !== 'admin'
  ) {
    return res.status(403).json({ 
      success: false, 
      error: 'Forbidden: You can only access your own profile unless you are an admin' 
    });
  }

  const user = await findUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      error: 'User not found' 
    });
  }

  delete user.password;
  res.json({ 
    success: true, 
    user 
  });
}

/**
 * GET /api/users
 */
export async function getAllUsers(req, res) {
  const users = await listUsers();
  users.forEach(u => delete u.password);
  res.json({ success: true, users });
}

/**
 * PUT /api/users/change-password
 */
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  const user = await findUserById(req.user.userId);
  const ok = await bcrypt.compare(currentPassword, user.password);

  if (!ok) {
    return res.status(401).json({ success: false });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.updatedAt = new Date().toISOString();
  await save(user);

  res.json({ success: true });
}

/**
 * DELETE /api/users/account
 */
export async function deactivateAccount(req, res) {
  const user = await findUserById(req.user.userId);
  user.isActive = 0;
  user.updatedAt = new Date().toISOString();
  await save(user);

  res.json({ success: true });
}

/**
 * POST /api/users/verify-token
 */
export async function verifyToken(req, res) {
  try {
    const decoded = jwt.verify(req.body.token, env.jwtSecret);
    const user = await findUserById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(404).json({ success: false });
    }

    res.json({
      success: true,
      valid: true,
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
    });
  } catch {
    res.status(401).json({ success: false, valid: false });
  }
}
