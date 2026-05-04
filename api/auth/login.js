// /api/auth/login.js
/**
 * POST /api/auth/login
 * 
 * ALUR LOGIN:
 * 1. Validate input (username & password tidak kosong)
 * 2. Query database cari user by username
 * 3. Compare password input dengan hash di database (bcrypt)
 * 4. Jika match:
 *    - Generate JWT token
 *    - Return token + user data + role
 * 5. Jika tidak match:
 *    - Return error 401
 * 
 * REQUEST BODY:
 * {
 *   "username": "budi_2020",
 *   "password": "alumni123"
 * }
 * 
 * RESPONSE SUCCESS (200):
 * {
 *   "success": true,
 *   "message": "Login successful",
 *   "data": {
 *     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *     "user": {
 *       "user_id": 3,
 *       "username": "budi_2020",
 *       "email": "budi@alumni.local",
 *       "full_name": "Budi Santoso",
 *       "role": "alumni"
 *     }
 *   },
 *   "code": 200
 * }
 * 
 * RESPONSE ERROR (401):
 * {
 *   "success": false,
 *   "message": "Invalid username or password",
 *   "code": 401
 * }
 */

const bcrypt = require('bcrypt');
const { query } = require('../../config/db');
const { generateToken, sendResponse } = require('../../middleware/auth');

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
    // STEP 2: VALIDATE INPUT
    // ============================================
    const { username, password } = req.body;

    // Validate tidak kosong
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
        code: 400,
      });
    }

    // Validate format (security: prevent injection)
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid input format',
        code: 400,
      });
    }

    // Validate panjang minimal
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Username min 3 chars, password min 6 chars',
        code: 400,
      });
    }

    // ============================================
    // STEP 3: QUERY DATABASE (Prepared Statement)
    // ============================================
    // PENTING: Gunakan ? placeholder untuk prevent SQL Injection
    // Contoh query yang SALAH:
    //   SELECT * FROM users WHERE username = '${username}'
    // Jika username = ' OR '1'='1', query jadi:
    //   SELECT * FROM users WHERE username = '' OR '1'='1'
    //   ^ Bakal return semua user!
    // 
    // Dengan prepared statement:
    //   SELECT * FROM users WHERE username = ?
    // Value di-escape otomatis → ' OR '1'='1' → literal string
    
    const users = await query(
      'SELECT user_id, username, email, password_hash, full_name, role, is_active FROM users WHERE username = ? LIMIT 1',
      [username] // Value di-pass terpisah, otomatis escaped
    );

    // ============================================
    // STEP 4: CHECK USER DITEMUKAN
    // ============================================
    if (users.length === 0) {
      // SECURITY TIP: Jangan reveal bahwa username tidak ada
      // Gunakan generic message untuk prevent username enumeration
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
        code: 401,
      });
    }

    const user = users[0];

    // ============================================
    // STEP 5: CHECK USER ACTIVE
    // ============================================
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your account is inactive. Contact administrator.',
        code: 403,
      });
    }

    // ============================================
    // STEP 6: BCRYPT - COMPARE PASSWORD
    // ============================================
    // Password di database: hashed dengan bcrypt
    // Password di login form: plain text
    // 
    // ALUR BCRYPT:
    // 1. Hash plain password dengan salt dari stored hash
    // 2. Compare hasil hash dengan stored hash
    // 3. Jika match → Password correct
    // 
    // MENGAPA BCRYPT?
    // - Slow by design → Brute force lebih sulit
    // - Adaptive → Semakin kuat CPU, semakin lambat (future-proof)
    // - Include salt → Rainbow table attack tidak bisa
    // - Industry standard
    // 
    // TIMING ATTACK:
    // Bcrypt compare always take same time (password correct or not)
    // → Attacker tidak bisa timing-based guess password

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
        code: 401,
      });
    }

    // ============================================
    // STEP 7: GENERATE JWT TOKEN
    // ============================================
    // Token berisi: user_id, username, role, exp (24 jam)
    // Client simpan di localStorage
    // Setiap request ke protected endpoint, send token di header
    
    const token = generateToken({
      user_id: user.user_id,
      username: user.username,
      role: user.role,
    });

    // ============================================
    // STEP 8: LOG ACTIVITY (Audit Trail)
    // ============================================
    // Optional: Log ke activity_logs untuk audit
    await query(
      'INSERT INTO activity_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)',
      [
        user.user_id,
        'login',
        req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown',
        req.headers['user-agent'] || 'unknown',
      ]
    );

    // ============================================
    // STEP 9: RETURN SUCCESS RESPONSE
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token, // Client simpan ini di localStorage
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role, // Important: untuk determine dashboard mana yg ditampilkan
        },
      },
      code: 200,
    });
  } catch (error) {
    console.error('Login error:', error);

    // ============================================
    // ERROR HANDLING
    // ============================================
    // Jangan expose detail error ke client (security)
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
      code: 500,
    });
  }
};