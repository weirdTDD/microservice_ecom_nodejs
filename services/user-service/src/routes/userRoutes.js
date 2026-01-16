import { Router } from 'express';
import {
  register,
  login,
  getProfile,
  updateProfile,
  getUserById,
  getAllUsers,
  changePassword,
  deactivateAccount,
  verifyToken,
} from '../controllers/userController.js';

import {
  authenticate,
  authorize,
} from '../middleware/authMiddleware.js';

const router = Router();

/**
 * Public
 */
router.post('/register', register);
router.post('/login', login);
router.post('/verify-token', verifyToken);

/**
 * Authenticated
 */
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.delete('/account', authenticate, deactivateAccount);

/**
 * Admin / Self
 */
router.get('/:userId', authenticate, getUserById);

/**
 * Admin only
 */
router.get('/', authenticate, authorize('admin'), getAllUsers);

export default router;
