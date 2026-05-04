// /api/gallery/add-photo.js
/**
 * POST /api/gallery/add-photo
 * 
 * ALUR MENAMBAH FOTO KE ALBUM:
 * 1. Authenticate - cek JWT
 * 2. Authorize - alumni only
 * 3. Validate input (album_id, photo_url)
 * 4. Check album ownership (user yang create)
 * 5. Check album status (hanya pending yang bisa add foto)
 * 6. Insert photo ke gallery_photos
 * 7. Return photo_id
 * 
 * PENTING:
 * - photo_url HARUS sudah di-upload ke Cloudinary oleh client
 * - API ini HANYA store URL ke database, tidak process upload
 * 
 * REQUEST BODY:
 * {
 *   "album_id": 1,
 *   "photo_url": "https://res.cloudinary.com/alumni-sma/image/upload/v1704067200/photo.jpg",
 *   "caption": "Foto bersama keluarga besar alumni"
 * }
 * 
 * RESPONSE (201):
 * {
 *   "success": true,
 *   "message": "Photo added to album",
 *   "data": {
 *     "photo_id": 5,
 *     "album_id": 1,
 *     "photo_url": "https://res.cloudinary.com/..."
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

    const { album_id, photo_url, caption } = req.body;

    // ============================================
    // VALIDATE INPUT
    // ============================================
    if (!album_id || !photo_url) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: album_id, photo_url',
        code: 400,
      });
    }

    if (!photo_url.startsWith('https://res.cloudinary.com/')) {
      return res.status(400).json({
        success: false,
        message: 'photo_url must be a valid Cloudinary URL',
        code: 400,
      });
    }

    // ============================================
    // CHECK ALBUM OWNERSHIP
    // ============================================
    const albums = await query(
      'SELECT album_id, created_by, status FROM gallery_albums WHERE album_id = ? LIMIT 1',
      [album_id]
    );

    if (albums.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Album not found',
        code: 404,
      });
    }

    const album = albums[0];

    // Hanya creator yang bisa add photo
    if (album.created_by !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only add photos to your own albums',
        code: 403,
      });
    }

    // Hanya pending album yang bisa add foto
    if (album.status !== 'pending') {
      return res.status(403).json({
        success: false,
        message: `Cannot add photos to ${album.status} album. Only pending albums can be modified.`,
        code: 403,
      });
    }

    // ============================================
    // GET LAST DISPLAY ORDER
    // ============================================
    const orderResults = await query(
      'SELECT MAX(display_order) AS max_order FROM gallery_photos WHERE album_id = ?',
      [album_id]
    );

    const nextOrder = (orderResults[0]?.max_order || 0) + 1;

    // ============================================
    // INSERT PHOTO
    // ============================================
    const result = await query(
      `INSERT INTO gallery_photos (album_id, photo_url, caption, display_order) 
       VALUES (?, ?, ?, ?)`,
      [album_id, photo_url, caption || null, nextOrder]
    );

    return res.status(201).json({
      success: true,
      message: 'Photo added to album successfully',
      data: {
        photo_id: result.insertId,
        album_id,
        photo_url,
        display_order: nextOrder,
      },
      code: 201,
    });
  } catch (error) {
    console.error('Add photo error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to add photo.',
      code: 500,
    });
  }
};