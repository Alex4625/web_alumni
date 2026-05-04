// /api/public/gallery.js
/**
 * GET /api/public/gallery
 * 
 * ALUR GET GALERI:
 * 1. Parse query params (page, limit, album_id)
 * 2. Filter: hanya approved albums
 * 3. Jika album_id provided: get photos dari album tsb
 * 4. Jika tidak: get list albums
 * 5. Paginate
 * 6. Return data
 * 
 * QUERY PARAMS:
 * - page: Halaman (default: 1)
 * - limit: Items per page (default: 10)
 * - album_id: Get photos dari album spesifik
 * 
 * RESPONSE (LIST ALBUMS):
 * {
 *   "success": true,
 *   "data": {
 *     "pagination": { ... },
 *     "albums": [
 *       {
 *         "album_id": 1,
 *         "album_name": "Gathering Alumni 2024",
 *         "description": "...",
 *         "album_cover_url": "https://res.cloudinary.com/...",
 *         "created_by": "budi_2020",
 *         "full_name": "Budi Santoso",
 *         "created_at": "2024-01-20T10:00:00Z",
 *         "photo_count": 5
 *       }
 *     ]
 *   }
 * }
 */

const { query } = require('../../config/db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use GET.',
        code: 405,
      });
    }

    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 10;
    const albumId = req.query.album_id;

    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const offset = (page - 1) * limit;

    // ============================================
    // CASE 1: GET PHOTOS DARI ALBUM SPESIFIK
    // ============================================
    if (albumId) {
      // Check album exists & approved
      const albums = await query(
        'SELECT album_id, album_name, album_cover_url FROM gallery_albums WHERE album_id = ? AND status = "approved" LIMIT 1',
        [albumId]
      );

      if (albums.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Album not found or not approved',
          code: 404,
        });
      }

      // Get photos
      const photos = await query(
        `SELECT photo_id, photo_url, caption, display_order 
         FROM gallery_photos WHERE album_id = ? 
         ORDER BY display_order ASC`,
        [albumId]
      );

      return res.status(200).json({
        success: true,
        data: {
          album: albums[0],
          photos,
        },
        code: 200,
      });
    }

    // ============================================
    // CASE 2: GET LIST ALBUMS (APPROVED ONLY)
    // ============================================

    // Count approved albums
    const countResults = await query(
      'SELECT COUNT(*) AS total_records FROM gallery_albums WHERE status = "approved"'
    );
    const totalRecords = countResults[0]?.total_records || 0;

    // Get albums with photo count
    const albums = await query(
      `SELECT 
        ga.album_id,
        ga.album_name,
        ga.description,
        ga.album_cover_url,
        ga.created_at,
        u.username,
        u.full_name,
        (SELECT COUNT(*) FROM gallery_photos WHERE album_id = ga.album_id) AS photo_count
       FROM gallery_albums ga
       INNER JOIN users u ON ga.created_by = u.user_id
       WHERE ga.status = 'approved'
       ORDER BY ga.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data: {
        pagination: {
          page,
          limit,
          total_records: totalRecords,
          total_pages: totalPages,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
        albums,
      },
      code: 200,
    });
  } catch (error) {
    console.error('Gallery error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to retrieve gallery.',
      code: 500,
    });
  }
};