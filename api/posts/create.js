// /api/posts/create.js
/**
 * POST /api/posts/create
 * 
 * ALUR PEMBUATAN POSTINGAN:
 * 1. Authenticate - cek JWT token valid
 * 2. Authorize - hanya alumni yang bisa create
 * 3. Validate input (title, content)
 * 4. Insert ke posts table dengan status = 'pending'
 * 5. Jika ada images, insert ke post_images table
 * 6. Return post_id + data
 * 
 * REQUEST BODY:
 * {
 *   "title": "Tips Memulai Karir di Tech",
 *   "content": "Berbagi pengalaman saya selama 3 tahun...",
 *   "images": [
 *     "https://res.cloudinary.com/alumni-sma/image/upload/v1704067200/post1.jpg",
 *     "https://res.cloudinary.com/alumni-sma/image/upload/v1704067200/post2.jpg"
 *   ]
 * }
 * 
 * RESPONSE SUCCESS (201):
 * {
 *   "success": true,
 *   "message": "Post created successfully. Pending admin approval.",
 *   "data": {
 *     "post_id": 3,
 *     "title": "Tips Memulai Karir di Tech",
 *     "status": "pending",
 *     "created_at": "2024-01-20T10:00:00Z",
 *     "images_count": 2
 *   }
 * }
 */

const { query, transaction } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

// ============================================
// HELPER: VALIDATE URL (Cloudinary)
// ============================================
const isValidCloudinaryUrl = (url) => {
  return url.startsWith('https://res.cloudinary.com/');
};

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
    // STEP 2: AUTHENTICATE
    // ============================================
    try {
      req = await authenticate(req);
    } catch (authError) {
      return res.status(401).json({
        success: false,
        message: `Authentication failed: ${authError.message}`,
        code: 401,
      });
    }

    // ============================================
    // STEP 3: AUTHORIZE (Alumni only)
    // ============================================
    try {
      await authorizeRole(req, ['alumni']);
    } catch (authzError) {
      return res.status(403).json({
        success: false,
        message: `Authorization failed: ${authzError.message}`,
        code: 403,
      });
    }

    // ============================================
    // STEP 4: VALIDATE INPUT
    // ============================================
    const { title, content, images = [] } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: title, content',
        code: 400,
      });
    }

    // Validate title length
    if (title.trim().length < 5 || title.trim().length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Title must be between 5 and 200 characters',
        code: 400,
      });
    }

    // Validate content length
    if (content.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Content must be at least 10 characters',
        code: 400,
      });
    }

    // Validate images (optional)
    if (!Array.isArray(images)) {
      return res.status(400).json({
        success: false,
        message: 'Images must be an array',
        code: 400,
      });
    }

    // Validate image URLs (max 5 images)
    if (images.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 images per post',
        code: 400,
      });
    }

    // Validate setiap image URL
    for (let i = 0; i < images.length; i++) {
      if (!isValidCloudinaryUrl(images[i])) {
        return res.status(400).json({
          success: false,
          message: `Image ${i + 1} must be a valid Cloudinary URL`,
          code: 400,
        });
      }
    }

    // ============================================
    // STEP 5: INSERT POST + IMAGES (TRANSACTION)
    // ============================================
    /**
     * Alur transaction:
     * 1. BEGIN
     * 2. INSERT posts (status = 'pending' by default)
     * 3. INSERT post_images untuk setiap image
     * 4. INSERT activity_logs
     * 5. COMMIT
     * 
     * Jika ada error di step 3 atau 4, semua rollback
     */
    const result = await transaction(async (connection) => {
      // Insert post
      const [postResult] = await connection.execute(
        `INSERT INTO posts (user_id, title, content, status) 
         VALUES (?, ?, ?, 'pending')`,
        [req.user.user_id, title.trim(), content.trim()]
      );

      const postId = postResult.insertId;

      // Insert images (jika ada)
      if (images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          await connection.execute(
            `INSERT INTO post_images (post_id, image_url, display_order) 
             VALUES (?, ?, ?)`,
            [postId, images[i], i]
          );
        }
      }

      // Log activity
      await connection.execute(
        `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          req.user.user_id,
          'create_post',
          'posts',
          postId,
          req.headers['x-forwarded-for'] || 'unknown',
          req.headers['user-agent'] || 'unknown',
        ]
      );

      return { post_id: postId };
    });

    // ============================================
    // STEP 6: RETURN SUCCESS RESPONSE
    // ============================================
    return res.status(201).json({
      success: true,
      message: 'Post created successfully. Pending admin approval.',
      data: {
        post_id: result.post_id,
        title,
        status: 'pending',
        created_at: new Date().toISOString(),
        images_count: images.length,
        note: 'Your post is awaiting admin approval before it can be published.',
      },
      code: 201,
    });
  } catch (error) {
    console.error('Create post error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to create post.',
      code: 500,
    });
  }
};