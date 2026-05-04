// /api/posts/list.js
/**
 * GET /api/posts/list
 * 
 * ALUR GET POSTINGAN:
 * 1. Parse query params (page, limit, status, user_id)
 * 2. Determine visibility berdasarkan user role:
 *    - Super Admin & Admin: Lihat semua (pending, approved, rejected)
 *    - Alumni: Lihat postingan sendiri (all status) + postingan orang lain (approved only)
 *    - Guest: Lihat approved only
 * 3. Build WHERE clause dinamis
 * 4. Count & paginate
 * 5. Return data
 * 
 * QUERY PARAMS:
 * - page: Nomor halaman (default: 1)
 * - limit: Items per page (default: 10, max: 50)
 * - status: Filter status (pending, approved, rejected)
 * - user_id: Filter by author (hanya jika alumni view sendiri)
 * 
 * RESPONSE (200):
 * {
 *   "success": true,
 *   "data": {
 *     "pagination": { page, limit, total_records, total_pages, has_next, has_prev },
 *     "posts": [
 *       {
 *         "post_id": 1,
 *         "title": "...",
 *         "content": "...",
 *         "status": "approved",
 *         "user_id": 3,
 *         "full_name": "Budi Santoso",
 *         "username": "budi_2020",
 *         "created_at": "2024-01-20T10:00:00Z",
 *         "images_count": 2,
 *         "approved_at": "2024-01-20T11:00:00Z",
 *         "approved_by_name": "Admin Alumni"
 *       }
 *     ]
 *   }
 * }
 */

const { query } = require('../../config/db');
const { authenticate } = require('../../middleware/auth');

// ============================================
// HELPER: BUILD WHERE CLAUSE BERDASARKAN ROLE
// ============================================
const buildPostWhere = async (req) => {
  let whereClause = '';
  const params = [];

  // Jika user authenticated (alumni)
  if (req.user) {
    const { role, user_id } = req.user;

    if (role === 'super_admin' || role === 'admin') {
      // Admin: lihat semua postingan
      // Bisa filter by status jika dikirim
      const status = req.query.status;
      if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        whereClause = 'p.status = ?';
        params.push(status);
      }
    } else if (role === 'alumni') {
      // Alumni: lihat postingan sendiri (semua status) + orang lain (approved only)
      whereClause = '(p.user_id = ? OR p.status = "approved")';
      params.push(user_id);
    }
  } else {
    // Guest: hanya approved postingan
    whereClause = 'p.status = "approved"';
  }

  return { whereClause, params };
};

module.exports = async (req, res) => {
  try {
    // ============================================
    // STEP 1: VALIDATE REQUEST METHOD
    // ============================================
    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use GET.',
        code: 405,
      });
    }

    // ============================================
    // STEP 2: AUTHENTICATE (OPTIONAL)
    // ============================================
    try {
      req = await authenticate(req);
    } catch {
      // Guest mode: tidak error, tapi req.user jadi undefined
      req.user = null;
    }

    // ============================================
    // STEP 3: PARSE PAGINATION PARAMS
    // ============================================
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 10;

    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const offset = (page - 1) * limit;

    // ============================================
    // STEP 4: BUILD WHERE CLAUSE
    // ============================================
    const { whereClause, params } = await buildPostWhere(req);

    // ============================================
    // STEP 5: COUNT TOTAL RECORDS
    // ============================================
    const countQuery = `
      SELECT COUNT(*) AS total_records
      FROM posts p
      WHERE ${whereClause}
    `;

    const countResults = await query(countQuery, params);
    const totalRecords = countResults[0]?.total_records || 0;

    // ============================================
    // STEP 6: QUERY POSTS WITH PAGINATION
    // ============================================
    /**
     * Query ini ambil:
     * - Post data
     * - Author data (username, full_name)
     * - Admin yang approve data (approved_by_name)
     * - Count images
     * 
     * ORDER BY: created_at DESC (newest first)
     */
    const dataQuery = `
      SELECT 
        p.post_id,
        p.title,
        p.content,
        p.status,
        p.created_at,
        p.updated_at,
        p.approved_at,
        p.rejection_reason,
        u.user_id,
        u.username,
        u.full_name,
        admin.full_name AS approved_by_name,
        (SELECT COUNT(*) FROM post_images WHERE post_id = p.post_id) AS images_count
      FROM posts p
      INNER JOIN users u ON p.user_id = u.user_id
      LEFT JOIN users admin ON p.approved_by = admin.user_id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const postParams = [...params, limit, offset];
    const posts = await query(dataQuery, postParams);

    // ============================================
    // STEP 7: CALCULATE PAGINATION METADATA
    // ============================================
    const totalPages = Math.ceil(totalRecords / limit);
    const hasPrev = page > 1;
    const hasNext = page < totalPages;

    // ============================================
    // STEP 8: RETURN RESPONSE
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Posts retrieved successfully',
      data: {
        pagination: {
          page,
          limit,
          total_records: totalRecords,
          total_pages: totalPages,
          has_next: hasNext,
          has_prev: hasPrev,
        },
        posts,
      },
      code: 200,
    });
  } catch (error) {
    console.error('List posts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to retrieve posts.',
      code: 500,
    });
  }
};