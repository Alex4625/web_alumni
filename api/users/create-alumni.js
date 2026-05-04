// /api/users/create-alumni.js
/**
 * POST /api/users/create-alumni
 * 
 * ALUR PEMBUATAN AKUN ALUMNI:
 * 1. Authenticate request (cek JWT token)
 * 2. Authorize - hanya super_admin & admin
 * 3. Validate input (username, email, full_name, kelas, tahun_lulus)
 * 4. Check duplikasi username & email di database
 * 5. Hash password default dengan bcrypt
 * 6. Insert users + alumni_profiles dalam transaction
 * 7. Return success dengan user data
 * 
 * REQUEST BODY:
 * {
 *   "username": "andi_2021",
 *   "email": "andi@alumni.local",
 *   "full_name": "Andi Wijaya",
 *   "kelas": "IPA",
 *   "tahun_lulus": 2021,
 *   "phone": "081234567890",
 *   "city": "Bandung",
 *   "occupation": "Student"
 * }
 * 
 * RESPONSE SUCCESS (201):
 * {
 *   "success": true,
 *   "message": "Alumni account created successfully",
 *   "data": {
 *     "user_id": 6,
 *     "username": "andi_2021",
 *     "email": "andi@alumni.local",
 *     "full_name": "Andi Wijaya",
 *     "role": "alumni",
 *     "temporary_password": "TempPass123!@#",
 *     "alumni_id": 4,
 *     "kelas": "IPA",
 *     "tahun_lulus": 2021
 *   }
 * }
 * 
 * RESPONSE ERROR:
 * - 400: Invalid input
 * - 401: Unauthorized
 * - 403: Forbidden (not admin)
 * - 409: Username/email already exists
 * - 500: Server error
 */

const bcrypt = require('bcrypt');
const { query, transaction } = require('../../config/db');
const { authenticate, authorizeRole, sendResponse } = require('../../middleware/auth');

// ============================================
// HELPER: GENERATE RANDOM PASSWORD
// ============================================
/**
 * Generate temporary password untuk alumni baru
 * Format: 8 chars + 1 uppercase + 1 number + 1 special char
 * 
 * Contoh: "Pass1234@xyz"
 * 
 * PENTING: 
 * - Password ini TEMPORARY
 * - Alumni harus change saat first login
 * - Atau request password baru via password_requests table
 */
const generateTemporaryPassword = () => {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';

  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  for (let i = 0; i < 4; i++) {
    const chars = uppercase + lowercase + numbers;
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  // Shuffle password
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
};

// ============================================
// HELPER: VALIDATE EMAIL FORMAT
// ============================================
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ============================================
// HELPER: VALIDATE USERNAME FORMAT
// ============================================
const isValidUsername = (username) => {
  // Only alphanumeric, underscore, hyphen (3-50 chars)
  const usernameRegex = /^[a-zA-Z0-9_-]{3,50}$/;
  return usernameRegex.test(username);
};

module.exports = async (req, res) => {
  try {
    // ============================================
    // STEP 1: VALIDATE REQUEST METHOD
    // ============================================
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use POST.',
        code: 405,
      });
    }

    // ============================================
    // STEP 2: AUTHENTICATE REQUEST
    // ============================================
    try {
      req = await authenticate(req);
    } catch (authError) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${authError.message}`,
        code: 401,
      });
    }

    // ============================================
    // STEP 3: AUTHORIZE ROLE (Super Admin or Admin only)
    // ============================================
    try {
      await authorizeRole(req, ['super_admin', 'admin']);
    } catch (authzError) {
      return res.status(403).json({
        success: false,
        message: `Authorization failed: ${authzError.message}`,
        code: 403,
      });
    }

    // ============================================
    // STEP 4: VALIDATE INPUT
    // ============================================
    const {
      username,
      email,
      full_name,
      kelas,
      tahun_lulus,
      phone,
      city,
      occupation,
    } = req.body;

    // Required fields
    if (!username || !email || !full_name || !kelas || !tahun_lulus) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: username, email, full_name, kelas, tahun_lulus',
        code: 400,
      });
    }

    // Validate username format
    if (!isValidUsername(username)) {
      return res.status(400).json({
        success: false,
        message: 'Username must be 3-50 chars, alphanumeric + underscore/hyphen only',
        code: 400,
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        code: 400,
      });
    }

    // Validate full_name tidak kosong
    if (full_name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Full name must be at least 3 characters',
        code: 400,
      });
    }

    // Validate kelas
    const validKelas = ['IPA', 'IPS_A', 'IPS_B'];
    if (!validKelas.includes(kelas)) {
      return res.status(400).json({
        success: false,
        message: `Kelas must be one of: ${validKelas.join(', ')}`,
        code: 400,
      });
    }

    // Validate tahun_lulus (reasonable range)
    const currentYear = new Date().getFullYear();
    if (tahun_lulus < 1990 || tahun_lulus > currentYear) {
      return res.status(400).json({
        success: false,
        message: `Tahun lulus must be between 1990 and ${currentYear}`,
        code: 400,
      });
    }

    // ============================================
    // STEP 5: CHECK DUPLIKASI USERNAME & EMAIL
    // ============================================
    const existingUsers = await query(
      'SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Username or email already exists',
        code: 409,
      });
    }

    // ============================================
    // STEP 6: GENERATE TEMPORARY PASSWORD & HASH
    // ============================================
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(
      temporaryPassword,
      parseInt(process.env.BCRYPT_ROUNDS || 10)
    );

    // ============================================
    // STEP 7: INSERT USER + ALUMNI PROFILE (TRANSACTION)
    // ============================================
    // Gunakan transaction: jika ada error di tengah, rollback semua
    // Jadi tidak ada orphaned records (user ada tapi profile tidak)
    
    const result = await transaction(async (connection) => {
      // Insert users table
      const [userResult] = await connection.execute(
        `INSERT INTO users (username, email, password_hash, role, full_name, is_active) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, email, passwordHash, 'alumni', full_name, true]
      );

      const userId = userResult.insertId;

      // Insert alumni_profiles table
      const [profileResult] = await connection.execute(
        `INSERT INTO alumni_profiles (user_id, kelas, tahun_lulus, phone, city, occupation) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, kelas, tahun_lulus, phone || null, city || null, occupation || null]
      );

      const alumniId = profileResult.insertId;

      // Log activity
      await connection.execute(
        `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          req.user.user_id,
          'create_alumni_account',
          'users',
          userId,
          req.headers['x-forwarded-for'] || 'unknown',
          req.headers['user-agent'] || 'unknown',
        ]
      );

      return {
        user_id: userId,
        alumni_id: alumniId,
      };
    });

    // ============================================
    // STEP 8: RETURN SUCCESS RESPONSE
    // ============================================
    return res.status(201).json({
      success: true,
      message: 'Alumni account created successfully',
      data: {
        user_id: result.user_id,
        username,
        email,
        full_name,
        role: 'alumni',
        temporary_password: temporaryPassword, // PENTING: Komunikasikan ke alumni
        alumni_id: result.alumni_id,
        kelas,
        tahun_lulus,
      },
      code: 201,
    });
  } catch (error) {
    console.error('Create alumni error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to create alumni account.',
      code: 500,
    });
  }
};