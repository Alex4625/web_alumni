// /api/alumni/profile.js
/**
 * GET /api/alumni/profile
 * - Retrieve profil alumni yang login
 * 
 * PUT /api/alumni/profile
 * - Update profil alumni sendiri
 * 
 * AUTHENTICATION: REQUIRED (JWT token)
 * ROLE: Alumni only
 * 
 * GET REQUEST:
 * Authorization: Bearer <token>
 * 
 * GET RESPONSE (200):
 * {
 *   "success": true,
 *   "message": "Profile retrieved",
 *   "data": {
 *     "user": {
 *       "user_id": 3,
 *       "username": "budi_2020",
 *       "email": "budi@alumni.local",
 *       "full_name": "Budi Santoso"
 *     },
 *     "profile": {
 *       "alumni_id": 1,
 *       "kelas": "IPA",
 *       "tahun_lulus": 2020,
 *       "phone": "081234567890",
 *       "city": "Jakarta",
 *       "occupation": "Software Engineer",
 *       "company": "PT TechnoIndo",
 *       "bio": "...",
 *       "profile_photo_url": "https://res.cloudinary.com/...",
 *       "linkedin_url": "linkedin.com/in/budi-santoso",
 *       "instagram_handle": "@budi_code",
 *       "created_at": "2024-01-01T10:00:00Z",
 *       "updated_at": "2024-01-15T15:30:00Z"
 *     }
 *   }
 * }
 * 
 * PUT REQUEST BODY:
 * {
 *   "phone": "081234567890",
 *   "city": "Jakarta",
 *   "occupation": "Senior Software Engineer",
 *   "company": "PT TechnoIndo",
 *   "bio": "Passionate about coding and open source",
 *   "linkedin_url": "linkedin.com/in/budi-santoso",
 *   "instagram_handle": "@budi_code",
 *   "profile_photo_url": "https://res.cloudinary.com/..." // dari Cloudinary upload
 * }
 * 
 * PUT RESPONSE (200):
 * {
 *   "success": true,
 *   "message": "Profile updated successfully",
 *   "data": {
 *     "profile": { ... updated profile data ... }
 *   }
 * }
 */

const { query } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

// ============================================
// HELPER: VALIDATE URL (LinkedIn, Instagram)
// ============================================
const isValidUrl = (url) => {
  if (!url) return true; // Optional field
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// ============================================
// GET /api/alumni/profile
// ============================================
const handleGet = async (req, res) => {
  try {
    // Authenticate & check alumni role
    try {
      req = await authenticate(req);
      await authorizeRole(req, ['alumni']);
    } catch (authError) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${authError.message}`,
        code: 401,
      });
    }

    const userId = req.user.user_id;

    // ============================================
    // STEP 1: QUERY USER DATA
    // ============================================
    const users = await query(
      'SELECT user_id, username, email, full_name FROM users WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 404,
      });
    }

    // ============================================
    // STEP 2: QUERY ALUMNI PROFILE
    // ============================================
    const profiles = await query(
      `SELECT 
        alumni_id, kelas, tahun_lulus, phone, city, occupation, company, bio,
        profile_photo_url, linkedin_url, instagram_handle, created_at, updated_at
       FROM alumni_profiles WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alumni profile not found',
        code: 404,
      });
    }

    // ============================================
    // STEP 3: RETURN RESPONSE
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: users[0],
        profile: profiles[0],
      },
      code: 200,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to retrieve profile.',
      code: 500,
    });
  }
};

// ============================================
// PUT /api/alumni/profile
// ============================================
const handlePut = async (req, res) => {
  try {
    // Authenticate & check alumni role
    try {
      req = await authenticate(req);
      await authorizeRole(req, ['alumni']);
    } catch (authError) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${authError.message}`,
        code: 401,
      });
    }

    const userId = req.user.user_id;
    const {
      phone,
      city,
      occupation,
      company,
      bio,
      linkedin_url,
      instagram_handle,
      profile_photo_url,
    } = req.body;

    // ============================================
    // STEP 1: VALIDATE INPUT
    // ============================================
    // All fields optional, tapi jika ada harus valid

    if (linkedin_url && !isValidUrl(linkedin_url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid LinkedIn URL',
        code: 400,
      });
    }

    if (profile_photo_url && !isValidUrl(profile_photo_url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid profile photo URL',
        code: 400,
      });
    }

    // Validate data length untuk prevent oversized data
    if (bio && bio.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Bio must be max 1000 characters',
        code: 400,
      });
    }

    if (occupation && occupation.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Occupation must be max 100 characters',
        code: 400,
      });
    }

    // ============================================
    // STEP 2: CHECK ALUMNI PROFILE EXISTS
    // ============================================
    const profiles = await query(
      'SELECT alumni_id FROM alumni_profiles WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alumni profile not found',
        code: 404,
      });
    }

    // ============================================
    // STEP 3: BUILD DYNAMIC UPDATE QUERY
    // ============================================
    /**
     * Alur:
     * 1. Start dengan kolom yang tidak boleh update (kelas, tahun_lulus)
     * 2. Check mana field yang di-provide di request body
     * 3. Build SET clause hanya untuk field yang ada
     * 4. Always set updated_at = NOW()
     * 5. Execute UPDATE dengan prepared statement
     * 
     * Contoh:
     * UPDATE alumni_profiles 
     * SET phone = ?, city = ?, occupation = ?, updated_at = NOW()
     * WHERE user_id = ?
     */
    const updateFields = [];
    const updateValues = [];

    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone || null);
    }
    if (city !== undefined) {
      updateFields.push('city = ?');
      updateValues.push(city || null);
    }
    if (occupation !== undefined) {
      updateFields.push('occupation = ?');
      updateValues.push(occupation || null);
    }
    if (company !== undefined) {
      updateFields.push('company = ?');
      updateValues.push(company || null);
    }
    if (bio !== undefined) {
      updateFields.push('bio = ?');
      updateValues.push(bio || null);
    }
    if (linkedin_url !== undefined) {
      updateFields.push('linkedin_url = ?');
      updateValues.push(linkedin_url || null);
    }
    if (instagram_handle !== undefined) {
      updateFields.push('instagram_handle = ?');
      updateValues.push(instagram_handle || null);
    }
    if (profile_photo_url !== undefined) {
      updateFields.push('profile_photo_url = ?');
      updateValues.push(profile_photo_url || null);
    }

    // Jika tidak ada field yang di-update, return error
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
        code: 400,
      });
    }

    // Selalu update timestamp
    updateFields.push('updated_at = NOW()');
    updateValues.push(userId); // WHERE user_id = ?

    // ============================================
    // STEP 4: EXECUTE UPDATE
    // ============================================
    const updateQuery = `
      UPDATE alumni_profiles 
      SET ${updateFields.join(', ')}
      WHERE user_id = ?
    `;

    await query(updateQuery, updateValues);

    // ============================================
    // STEP 5: LOG ACTIVITY
    // ============================================
    await query(
      `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'update_profile',
        'alumni_profiles',
        profiles[0].alumni_id,
        req.headers['x-forwarded-for'] || 'unknown',
        req.headers['user-agent'] || 'unknown',
      ]
    );

    // ============================================
    // STEP 6: QUERY UPDATED PROFILE
    // ============================================
    const updatedProfiles = await query(
      `SELECT 
        alumni_id, kelas, tahun_lulus, phone, city, occupation, company, bio,
        profile_photo_url, linkedin_url, instagram_handle, created_at, updated_at
       FROM alumni_profiles WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    // ============================================
    // STEP 7: RETURN SUCCESS RESPONSE
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: updatedProfiles[0],
      },
      code: 200,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to update profile.',
      code: 500,
    });
  }
};

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'PUT') {
    return handlePut(req, res);
  } else {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed. Use GET or PUT.',
      code: 405,
    });
  }
};