// /middleware/auth.js
/**
 * AUTHENTICATION & AUTHORIZATION MIDDLEWARE
 * 
 * Alur:
 * 1. Extract token dari request (header, cookie, atau body)
 * 2. Verify & decode token (JWT)
 * 3. Check apakah user masih active di database
 * 4. Validate role apakah boleh akses endpoint ini
 * 5. Attach user data ke request object
 * 
 * Strategi Session:
 * - Use JWT Token stored in client (localStorage)
 * - Token contain: user_id, username, role, exp (expiration)
 * - Validate di setiap request ke protected endpoints
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * VERIFY & DECODE JWT TOKEN
 * 
 * Parameter token dari:
 * - Header: Authorization: Bearer <token>
 * - Atau Cookie: session=<token>
 * - Atau Body: { token: <token> }
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    throw new Error(`Invalid or expired token: ${error.message}`);
  }
};

/**
 * MIDDLEWARE: AUTHENTICATION CHECK
 * 
 * Alur:
 * 1. Extract token dari berbagai sumber
 * 2. Verify token signature & expiration
 * 3. Query database cek user masih active
 * 4. Attach user data ke req.user
 * 5. Return error 401 jika gagal
 * 
 * Gunakan: Di awal setiap protected API endpoint
 * 
 * Contoh response error:
 * {
 *   "success": false,
 *   "message": "Unauthorized: Token expired",
 *   "code": 401
 * }
 */
const authenticate = async (req) => {
  try {
    // ============================================
    // 1. EXTRACT TOKEN
    // ============================================
    let token = null;

    // Cek Authorization header (Format: Bearer <token>)
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove "Bearer " prefix
    }

    // Fallback: Cek body atau query params
    if (!token && req.body?.token) {
      token = req.body.token;
    }

    if (!token && req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      throw new Error('No authentication token provided');
    }

    // ============================================
    // 2. VERIFY TOKEN SIGNATURE & EXPIRATION
    // ============================================
    const decoded = verifyToken(token);

    // ============================================
    // 3. QUERY DATABASE - CEK USER MASIH ACTIVE
    // ============================================
    const users = await query(
      'SELECT user_id, username, email, role, full_name, is_active FROM users WHERE user_id = ? LIMIT 1',
      [decoded.user_id]
    );

    if (users.length === 0) {
      throw new Error('User not found in database');
    }

    const user = users[0];

    if (!user.is_active) {
      throw new Error('User account is inactive');
    }

    // ============================================
    // 4. ATTACH USER DATA KE REQUEST
    // ============================================
    req.user = {
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
    };

    return req; // Return request dengan user data
  } catch (error) {
    throw error;
  }
};

/**
 * MIDDLEWARE: ROLE AUTHORIZATION CHECK
 * 
 * Alur:
 * 1. Check apakah request.user.role ada di allowedRoles
 * 2. Return error 403 jika role tidak sesuai
 * 3. Return success jika role match
 * 
 * Contoh penggunaan:
 * await authorizeRole(req, ['super_admin', 'admin']);
 * // Hanya super_admin & admin yang boleh lanjut
 * 
 * Role hierarchy:
 * - super_admin: Full access to everything
 * - admin: Moderasi & user management (tapi tidak bisa manage admin lain)
 * - alumni: Update profil sendiri, create post
 * - guest: Read-only (no authentication required)
 */
const authorizeRole = async (req, allowedRoles = []) => {
  try {
    // Jika no user attached (should tidak happen jika authenticate dipanggil duluan)
    if (!req.user) {
      throw new Error('User not authenticated');
    }

    // Check role
    if (!allowedRoles.includes(req.user.role)) {
      throw new Error(
        `Access denied: Role '${req.user.role}' not authorized. Required: ${allowedRoles.join(', ')}`
      );
    }

    return true; // Authorization granted
  } catch (error) {
    throw error;
  }
};

/**
 * HELPER: CREATE JWT TOKEN
 * 
 * Alur:
 * 1. Embed user data ke token payload
 * 2. Sign dengan JWT_SECRET
 * 3. Set expiration (24 jam)
 * 4. Return token string
 * 
 * Token payload:
 * {
 *   "user_id": 1,
 *   "username": "budi_2020",
 *   "role": "alumni",
 *   "iat": 1704067200,      // issued at
 *   "exp": 1704153600       // expires at (24 hours later)
 * }
 */
const generateToken = (user) => {
  const payload = {
    user_id: user.user_id,
    username: user.username,
    role: user.role,
  };

  // expiresIn: '24h' = token valid selama 24 jam
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '24h',
  });

  return token;
};

/**
 * HELPER: CREATE RESPONSE OBJECT (Standard format)
 * 
 * Semua API response pakai format ini untuk consistency:
 * {
 *   "success": true/false,
 *   "message": "...",
 *   "data": {...},
 *   "code": 200/401/403/500
 * }
 */
const sendResponse = (statusCode, success, message, data = null) => {
  return {
    statusCode,
    body: JSON.stringify({
      success,
      message,
      data,
      code: statusCode,
    }),
  };
};

module.exports = {
  authenticate,
  authorizeRole,
  generateToken,
  verifyToken,
  sendResponse,
};