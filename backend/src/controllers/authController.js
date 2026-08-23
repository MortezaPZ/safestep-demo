/**
 * کنترلر احراز هویت.
 * کنترلرها فقط ورودی را به سرویس می‌دهند و خروجی را به HTTP تبدیل می‌کنند.
 */
import authService from '../services/authService.js';
import { asyncHandler } from '../middleware/error.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, {
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json(result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, {
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken, {
    userAgent: req.headers['user-agent'],
  });
  res.json(result);
});

export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.body?.refreshToken);
  res.json(result);
});

export const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAll(req.user.id);
  res.json(result);
});

export const me = asyncHandler(async (req, res) => {
  const result = await authService.me(req.user.id);
  res.json(result);
});
