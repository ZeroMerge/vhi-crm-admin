import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import pool from '../../config/db';
import { sendEmail } from '../../utils/sendEmail';

const router = Router();

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'token is required'),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

router.post('/register', async (req, res, next) => {
  try {
    const { firstname, lastname, email, password, phone, industry } = req.body;

    if (!firstname || !lastname || !email || !password) {
      return res.status(400).json({ success: false, message: 'firstname, lastname, email, and password are required' });
    }

    const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'VHI-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    const isDev = process.env.NODE_ENV !== 'production';

    const insertResult = await pool.query(
      `INSERT INTO customers (user_id, firstname, lastname, email, phone, industry, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, firstname, lastname, email`,
      [userId, firstname, lastname, email, phone || null, industry || null, passwordHash, isDev]
    );

    const customer = insertResult.rows[0];

    if (!isDev) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        'INSERT INTO email_verification_tokens (customer_id, token, expires_at) VALUES ($1, $2, $3)',
        [customer.id, rawToken, expiresAt]
      );

      const verifyUrl = `${process.env.CLIENT_FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${rawToken}`;

      await sendEmail(
        email,
        'Verify your VHI account',
        `<p>Hi ${firstname},</p>
         <p>Click the link below to verify your email address. This link expires in 24 hours.</p>
         <p><a href="${verifyUrl}">${verifyUrl}</a></p>`
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id: customer.id,
        userId: customer.user_id,
        firstname: customer.firstname,
        lastname: customer.lastname,
        email: customer.email,
      },
      message: isDev ? 'Registration successful. You can now log in.' : 'Registration successful. Please check your email to verify your account.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    const tokenResult = await pool.query(
      'SELECT * FROM email_verification_tokens WHERE token = $1',
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid or already used token' });
    }

    const record = tokenResult.rows[0];

    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM email_verification_tokens WHERE id = $1', [record.id]);
      return res.status(410).json({ success: false, message: 'Verification link has expired. Please register again.' });
    }

    await pool.query('UPDATE customers SET is_active = true, updated_at = NOW() WHERE id = $1', [record.customer_id]);
    await pool.query('DELETE FROM email_verification_tokens WHERE id = $1', [record.id]);

    res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM customers WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const customer = result.rows[0];

    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!customer.is_active) {
      return res.status(401).json({ success: false, message: 'Account not verified. Please check your email.' });
    }

    const token = jwt.sign(
      { id: customer.id, email: customer.email, userId: customer.user_id },
      process.env.CLIENT_JWT_SECRET || 'client_fallback_secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    res.json({
      success: true,
      data: {
        token,
        customer: {
          id: customer.id,
          userId: customer.user_id,
          firstname: customer.firstname,
          lastname: customer.lastname,
          email: customer.email,
          industry: customer.industry,
          status: customer.status,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { email } = parsed.data;

    const result = await pool.query('SELECT id, firstname, is_active FROM customers WHERE email = $1', [email]);

    if (result.rows.length > 0) {
      const customer = result.rows[0];

      if (customer.is_active) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await pool.query(
          'INSERT INTO email_verification_tokens (customer_id, token, expires_at, type) VALUES ($1, $2, $3, $4)',
          [customer.id, rawToken, expiresAt, 'password_reset']
        );

        const resetUrl = `${process.env.CLIENT_FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;

        await sendEmail(
          email,
          'Reset your password',
          `<p>Hi ${customer.firstname},</p>
           <p>Click the link below to reset your password. This link expires in 1 hour.</p>
           <p><a href="${resetUrl}">${resetUrl}</a></p>`
        );
      }
    }

    res.json({ success: true, message: 'If an account exists with that email, a password reset link has been sent' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { token, password } = parsed.data;

    const tokenResult = await pool.query(
      'SELECT * FROM email_verification_tokens WHERE token = $1 AND type = $2',
      [token, 'password_reset']
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const record = tokenResult.rows[0];

    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM email_verification_tokens WHERE id = $1', [record.id]);
      return res.status(410).json({ success: false, message: 'Reset token has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE customers SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, record.customer_id]);
    await pool.query('DELETE FROM email_verification_tokens WHERE id = $1', [record.id]);

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
});

export default router;
