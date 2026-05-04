// /api/public/alumni-directory.js
/**
 * GET /api/public/alumni-directory
 * 
 * ALUR DIREKTORI ALUMNI:
 * 1. Parse query parameters (page, limit, search, kelas)
 * 2. Build dynamic WHERE clause berdasarkan filter
 * 3. Count total records
 * 4. Calculate pagination (offset = (page - 1) * limit)
 * 5. Query data dengan LIMIT & OFFSET
 * 6. Return data + pagination metadata
 * 
 * QUERY PARAMETERS:
 * - page: Nomor halaman (default: 1)
 * - limit: Jumlah data per halaman (default: 10, max: 100)
 * - search: Cari berdasarkan nama atau username (LIKE '%search%')
 * - kelas: Filter kelas (IPA, IPS_A, IPS_B)
 * 
 * CONTOH REQUEST:
 * GET /api/public/alumni-directory?page=1&limit=10&search=budi&kelas=IPA
 * 
 * RESPONSE:
 * {
 *   "success": true,
 *   "message": "Alumni directory retrieved",
 *   "data": {
 *     "pagination": {
 *       "page": 1,
 *       "limit": 10,
 *       "total_records": 25,
 *       "total_pages": 3,
 *       "has_next": true,
 *       "has_prev": false
 *     },
 *     "alumni": [
 *       {
 *         "user_id": 3,
 *         "username": "budi_2020",
 *         "full_name": "Budi Santoso",
 *         "kelas": "IPA",
 *         "tahun_lulus": 2020,
 *         "city": "Jakarta",
 *         "occupation": "Software Engineer",
 *         "company": "PT TechnoIndo",
 *         "profile_photo_url": "https://res.cloudinary.com/...",
 *         "linkedin_url": "linkedin.com/in/budi-santoso",
 *         "instagram_handle": "@budi_code"
 *       },
 *       ...
 *     ]
 *   },
 *   "code": 200
 * }
 */

const { query } = require('../../config/db');

// ============================================
// HELPER: BUILD WHERE CLAUSE DINAMIS
// ============================================
/**
 * Alur:
 * 1. Start dengan WHERE u.is_active = TRUE AND u.role = 'alumni'
 * 2. Jika search param ada:
 *    - Tambah: AND (u.full_name LIKE ? OR u.username LIKE ?)
 * 3. Jika kelas param ada:
 *    - Tambah: AND ap.kelas = ?
 * 4. Return { whereClause, params }
 */
const buildWhereClause = (search, kelas) => {
  let whereClause = 'u.is_active = TRUE AND u.role = "alumni"';
  const params = [];

  if (search && search.trim()) {
    // LIKE search: case-insensitive di MySQL
    whereClause += ' AND (u.full_name LIKE ? OR u.username LIKE ?)';
    const searchPattern = `%${search.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  if (kelas && ['IPA', 'IPS_A', 'IPS_B'].includes(kelas)) {
    whereClause += ' AND ap.kelas = ?';
    params.push(kelas);
  }

  return { whereClause, params };
};

// ============================================
// HELPER: VALIDATE & NORMALIZE PAGINATION PARAMS
// ============================================
const validatePaginationParams = (page, limit) => {
  let pageNum = parseInt(page, 10) || 1;
  let limitNum = parseInt(limit, 10) || 10;

  // Validate ranges
  if (pageNum < 1) pageNum = 1;
  if (limitNum < 1) limitNum = 10;
  if (limitNum > 100) limitNum = 100; // Prevent DOS: max 100 per page

  return { pageNum, limitNum };
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
    // STEP 2: PARSE QUERY PARAMETERS
    // ============================================
    const { page, limit, search, kelas } = req.query;

    const { pageNum, limitNum } = validatePaginationParams(page, limit);
    const { whereClause, params } = buildWhereClause(search, kelas);

    // ============================================
    // STEP 3: COUNT TOTAL RECORDS (untuk pagination metadata)
    // ============================================
    /**
     * Query ini menghitung total alumni yang match dengan filter
     * Penting: Gunakan prepared statement dengan params yang sama
     * 
     * Alur:
     * 1. Join users & alumni_profiles
     * 2. Apply WHERE clause (dengan filter search & kelas)
     * 3. COUNT(*)
     */
    const countQuery = `
      SELECT COUNT(*) AS total_records
      FROM users u
      INNER JOIN alumni_profiles ap ON u.user_id = ap.user_id
      WHERE ${whereClause}
    `;

    const countResults = await query(countQuery, params);
    const totalRecords = countResults[0]?.total_records || 0;

    // ============================================
    // STEP 4: CALCULATE PAGINATION METADATA
    // ============================================
    const totalPages = Math.ceil(totalRecords / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const hasPrev = pageNum > 1;
    const hasNext = pageNum < totalPages;

    // ============================================
    // STEP 5: QUERY DATA (dengan LIMIT & OFFSET)
    // ============================================
    /**
     * LIMIT & OFFSET:
     * - LIMIT 10: Return max 10 rows
     * - OFFSET 0: Start dari row pertama (page 1)
     * - OFFSET 10: Start dari row ke-11 (page 2)
     * - OFFSET 20: Start dari row ke-21 (page 3)
     * 
     * Formula: OFFSET = (page - 1) * limit
     * 
     * Alur query:
     * 1. SELECT kolom yang dibutuhkan
     * 2. JOIN users dengan alumni_profiles
     * 3. Filter dengan WHERE clause
     * 4. ORDER BY untuk konsistensi pagination
     * 5. LIMIT & OFFSET untuk pagination
     */
    const dataQuery = `
      SELECT 
        u.user_id,
        u.username,
        u.full_name,
        u.email,
        ap.alumni_id,
        ap.kelas,
        ap.tahun_lulus,
        ap.city,
        ap.occupation,
        ap.company,
        ap.profile_photo_url,
        ap.linkedin_url,
        ap.instagram_handle
      FROM users u
      INNER JOIN alumni_profiles ap ON u.user_id = ap.user_id
      WHERE ${whereClause}
      ORDER BY ap.tahun_lulus DESC, u.full_name ASC
      LIMIT ? OFFSET ?
    `;

    const alumniData = await query(dataQuery, [...params, limitNum, offset]);

    // ============================================
    // STEP 6: RETURN RESPONSE dengan PAGINATION METADATA
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Alumni directory retrieved successfully',
      data: {
        pagination: {
          page: pageNum,
          limit: limitNum,
          total_records: totalRecords,
          total_pages: totalPages,
          has_next: hasNext,
          has_prev: hasPrev,
        },
        alumni: alumniData,
      },
      code: 200,
    });
  } catch (error) {
    console.error('Alumni directory error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to retrieve alumni directory.',
      code: 500,
    });
  }
};