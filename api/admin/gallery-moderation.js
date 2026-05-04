// /api/admin/gallery-moderation.js
/**
 * PUT /api/admin/gallery-moderation
 * 
 * ALUR MODERASI GALERI:
 * 1. Authenticate - cek JWT
 * 2. Authorize - admin only
 * 3. Validate input (album_id, action)
 * 4. Check album status = pending
 * 5. Update status + approved_by
 * 6. Return updated album
 * 
 * REQUEST BODY:
 * {
 *   "album_id": 1,
 *   "action": "approve"
 * }
 */

const { query } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'PUT') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use PUT.',
        code: 405,
      });
    }

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

    const { album_id, action } = req.body;

    if (!album_id || !action) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: album_id, action',
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

    // Check album
    const albums = await query(
      'SELECT album_id, status FROM gallery_albums WHERE album_id = ? LIMIT 1',
      [album_id]
    );

    if (albums.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Album not found',
        code: 404,
      });
    }

    if (albums[0].status !== 'pending') {
      return res.status(403).json({
        success: false,
        message: `Cannot moderate album with status '${albums[0].status}'`,
        code: 403,
      });
    }

    // Update status
    await query(
      `UPDATE gallery_albums SET status = ?, approved_by = ?, approved_at = NOW() WHERE album_id = ?`,
      [action, req.user.user_id, album_id]
    );

    return res.status(200).json({
      success: true,
      message: `Album ${action}ed successfully`,
      data: { album_id, status: action },
      code: 200,
    });
  } catch (error) {
    console.error('Gallery moderation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to moderate gallery.',
      code: 500,
    });
  }
};