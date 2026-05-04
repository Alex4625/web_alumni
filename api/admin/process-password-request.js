// /api/admin/process-password-request.js
/**
 * PUT /api/admin/process-password-request
 * 
 * ALUR PROSES REQUEST PASSWORD:
 * 1. Authenticate - cek JWT (admin)
 * 2. Validate input (request_id, action: approve/reject)
 * 3. Check request status = pending
 * 4. Jika approve:
 *    - Generate temporary password
 *    - Hash password
 *    - Store di password_requests.temporary_password (hashed)
 *    - Return temporary_password (plain text sekali aja untuk admin copy)
 * 5. Jika reject:
 *    - Just update status = rejected
 * 6. Update approved_by + approved_at
 * 7. Log activity
 * 8. Return response
 * 
 * REQUEST BODY:
 * {
 *   "request_id": 5,
 *   "action": "approve"
 * }
 * 
 * RESPONSE (APPROVE - 200):
 * {
 *   "success": true,
 *   "message": "Password request approved",
 *   "data": {
 *     "request_id": 5,
 *     "user_id": 3,
 *     "username": "budi_2020",
 *     "temporary_password": "TempPass123!@#",
 *     "note": "Copy password & send to alumni via email/message"
 *   }
 * }
 */

const bcrypt = require('bcrypt');
const { query } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

// ============================================
// HELPER: GENERATE RANDOM PASSWORD
// ============================================
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

  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'PUT') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use PUT.',
        code: 405,
      });
    }

    // ============================================
    // STEP 1: AUTHENTICATE & AUTHORIZE
    // ============================================
    try {
      req = await authenticate(req);
      await authorizeRole(req, ['admin', 'super_admin']);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${error.message}`,
        code: 401,
      });
    }

    // ============================================
    // STEP 2: VALIDATE INPUT
    // ============================================
    const { request_id, action, rejection_reason } = req.body;

    if (!request_id || !action) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: request_id, action (approve/reject)',
        code: 400,
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be "approve" or "reject"',
        code: 400,
      });
    }

    // ============================================
    // STEP 3: QUERY PASSWORD REQUEST
    // ============================================
    const requests = await query(
      'SELECT request_id, user_id, status FROM password_requests WHERE request_id = ? LIMIT 1',
      [request_id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
        code: 404,
      });
    }

    const pwRequest = requests[0];

    // ============================================
    // STEP 4: CHECK STATUS (Hanya pending)
    // ============================================
    if (pwRequest.status !== 'pending') {
      return res.status(403).json({
        success: false,
        message: `Cannot process request with status '${pwRequest.status}'`,
        code: 403,
      });
    }

    // ============================================
    // STEP 5: GET USER DATA
    // ============================================
    const users = await query(
      'SELECT user_id, username, email FROM users WHERE user_id = ? LIMIT 1',
      [pwRequest.user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 404,
      });
    }

    const user = users[0];

    // ============================================
    // STEP 6: PROCESS REQUEST
    // ============================================
    if (action === 'approve') {
      // Generate temporary password
      const tempPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(
        tempPassword,
        parseInt(process.env.BCRYPT_ROUNDS || 10)
      );

      // Update password_requests
      await query(
        `UPDATE password_requests 
         SET status = 'approved', 
             approved_by = ?, 
             approved_at = NOW(), 
             temporary_password = ?,
             temporary_password_plain = ?
         WHERE request_id = ?`,
        [req.user.user_id, passwordHash, tempPassword, request_id]
      );

      // ============================================
      // STEP 7: ALSO UPDATE USER PASSWORD
      // ============================================
      /**
       * PENTING: Update juga di users table
       * Sehingga alumni bisa login dengan temporary password
       */
      await query(
        'UPDATE users SET password_hash = ? WHERE user_id = ?',
        [passwordHash, pwRequest.user_id]
      );

      // ============================================
      // STEP 8: LOG ACTIVITY
      // ============================================
      await query(
        `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          req.user.user_id,
          'approve_password_request',
          'password_requests',
          request_id,
          req.headers['x-forwarded-for'] || 'unknown',
          req.headers['user-agent'] || 'unknown',
        ]
      );

      // ============================================
      // STEP 9: RETURN SUCCESS WITH TEMP PASSWORD
      // ============================================
      return res.status(200).json({
        success: true,
        message: 'Password request approved. Temporary password generated.',
        data: {
          request_id,
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          temporary_password: tempPassword, // Hanya di-return 1x, copy & kirim ke alumni
          approved_at: new Date().toISOString(),
          note: 'Copy password & send to alumni via email/message. Alumni must change on first login.',
        },
        code: 200,
      });
    } else if (action === 'reject') {
      // Update status = rejected
      await query(
        `UPDATE password_requests 
         SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?
         WHERE request_id = ?`,
        [req.user.user_id, rejection_reason || null, request_id]
      );

      return res.status(200).json({
        success: true,
        message: 'Password request rejected',
        data: {
          request_id,
          status: 'rejected',
        },
        code: 200,
      });
    }
  } catch (error) {
    console.error('Process password request error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to process request.',
      code: 500,
    });
  }
};