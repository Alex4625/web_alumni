// /api/gallery/create-album.js
/**
 * POST /api/gallery/create-album
 * 
 * ALUR MEMBUAT ALBUM GALERI:
 * 1. Authenticate - cek JWT
 * 2. Authorize - alumni only
 * 3. Validate input (album_name, description)
 * 4. Insert ke gallery_albums (status = pending)
 * 5. Return album_id
 * 
 * REQUEST BODY:
 * {
 *   "album_name": "Gathering Alumni 2024",
 *   "description": "Acara gathering alumni tahun 2024",
 *   "album_cover_url": "https://res.cloudinary.com/..." (optional)
 * }
 * 
 * RESPONSE (201):
 * {
 *   "success": true,
 *   "message": "Album created successfully",
 *   "data": {
 *     "album_id": 1,
 *     "album_name": "Gathering Alumni 2024",
 *     "status": "pending"
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

    const { album_name, description, album_cover_url } = req.body;

    // ============================================
    // VALIDATE INPUT
    // ============================================
    if (!album_name) {
      return res.status(400).json({
        success: false,
        message: 'Required field: album_name',
        code: 400,
      });
    }

    if (album_name.trim().length < 3 || album_name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Album name must be between 3 and 100 characters',
        code: 400,
      });
    }

    // Validate cover URL jika ada
    if (album_cover_url && !album_cover_url.startsWith('https://res.cloudinary.com/')) {
      return res.status(400).json({
        success: false,
        message: 'Album cover must be a valid Cloudinary URL',
        code: 400,
      });
    }

    // ============================================
    // INSERT ALBUM
    // ============================================
    const result = await query(
      `INSERT INTO gallery_albums (created_by, album_name, description, album_cover_url, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [req.user.user_id, album_name.trim(), description || null, album_cover_url || null]
    );

    // ============================================
    // LOG ACTIVITY
    // ============================================
    await query(
      `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.user_id,
        'create_gallery_album',
        'gallery_albums',
        result.insertId,
        req.headers['x-forwarded-for'] || 'unknown',
        req.headers['user-agent'] || 'unknown',
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Album created successfully. Pending admin approval.',
      data: {
        album_id: result.insertId,
        album_name,
        status: 'pending',
      },
      code: 201,
    });
  } catch (error) {
    console.error('Create album error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to create album.',
      code: 500,
    });
  }
};
