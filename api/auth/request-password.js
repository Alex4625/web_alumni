// /api/auth/request-password.js
/**
 * POST /api/auth/request-password
 * 
 * ALUR REQUEST PASSWORD BARU:
 * 1. Authenticate - cek JWT (alumni login)
 * 2. Validate input (optional: reason)
 * 3. Check sudah ada pending request dari user ini (prevent spam)
 * 4. Insert ke password_requests (status = pending)
 * 5. Return success
 * 
 * FLOW PASSWORD RESET:
 * Alumni: request password baru (status = pending)
 *   ↓
 * Admin: melihat list pending requests
 *   ↓
 * Admin: approve request → system generate temp password & store hash
 *   ↓
 * System: email temp password ke alumni (future)
 *   ↓
 * Alumni: login dengan temp password
 * Alumni: must change password on first login
 * 
 * REQUEST BODY:
 * {
 *   "reason": "Lupa password" (optional)
 * }
 * 
 * RESPONSE (201):
 * {
 *   "success": true,
 *   "message": "Password request submitted. Admin will review shortly.",
 *   "data": {
 *     "request_id": 5,
 *     "status": "pending",
 *     "requested_at": "2024-01-20T10:00:00Z"
 *   }
 * }
 */

const { query } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use POST.',
        code: 405,
      });
    }

    // ============================================
    // STEP 1: AUTHENTICATE (Alumni only)
    // ============================================
    try {
      req = await authenticate(req);
      await authorizeRole(req, ['alumni']);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${error.message}`,
        code: 401,
      });
    }

    const userId = req.user.user_id;
    const { reason } = req.body;

    // ============================================
    // STEP 2: CHECK EXISTING PENDING REQUEST
    // ============================================
    /**
     * Prevent spam: jangan boleh ada 2 pending requests aktif
     * dari user yang sama
     */
    const pendingRequests = await query(
      'SELECT request_id FROM password_requests WHERE user_id = ? AND status = "pending" LIMIT 1',
      [userId]
    );

    if (pendingRequests.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending password request. Please wait for admin response.',
        code: 409,
      });
    }

    // ============================================
    // STEP 3: INSERT PASSWORD REQUEST
    // ============================================
    const result = await query(
      `INSERT INTO password_requests (user_id, status, requested_at) 
       VALUES (?, 'pending', NOW())`,
      [userId]
    );

    // ============================================
    // STEP 4: LOG ACTIVITY
    // ============================================
    await query(
      `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'request_password_reset',
        'password_requests',
        result.insertId,
        req.headers['x-forwarded-for'] || 'unknown',
        req.headers['user-agent'] || 'unknown',
      ]
    );

    // ============================================
    // STEP 5: RETURN SUCCESS
    // ============================================
    return res.status(201).json({
      success: true,
      message: 'Password request submitted. Admin will review shortly.',
      data: {
        request_id: result.insertId,
        status: 'pending',
        requested_at: new Date().toISOString(),
        note: 'You will receive a temporary password via email once your request is approved.',
      },
      code: 201,
    });
  } catch (error) {
    console.error('Request password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to submit request.',
      code: 500,
    });
  }
};