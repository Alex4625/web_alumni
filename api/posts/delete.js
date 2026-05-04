// /api/posts/delete.js
/**
 * DELETE /api/posts/delete
 * 
 * ALUR DELETE POSTINGAN:
 * 1. Authenticate - cek JWT
 * 2. Authorize - alumni only
 * 3. Query post - cek ownership & status
 * 4. Delete post (cascade delete post_images)
 * 5. Return success
 * 
 * REQUEST BODY:
 * { "post_id": 3 }
 * 
 * RESPONSE (200):
 * { "success": true, "message": "Post deleted successfully" }
 */

const { query } = require('../../config/db');
const { authenticate, authorizeRole } = require('../../middleware/auth');

module.exports = async (req, res) => {
  try {
    // ============================================
    // STEP 1: VALIDATE REQUEST METHOD
    // ============================================
    if (req.method !== 'DELETE') {
      return res.status(405).json({
        success: false,
        message: 'Method not allowed. Use DELETE.',
        code: 405,
      });
    }

    // ============================================
    // STEP 2: AUTHENTICATE & AUTHORIZE
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

    // ============================================
    // STEP 3: VALIDATE INPUT
    // ============================================
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json({
        success: false,
        message: 'Required field: post_id',
        code: 400,
      });
    }

    // ============================================
    // STEP 4: QUERY POST
    // ============================================
    const posts = await query(
      'SELECT post_id, user_id, status FROM posts WHERE post_id = ? LIMIT 1',
      [post_id]
    );

    if (posts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found',
        code: 404,
      });
    }

    const post = posts[0];

    // ============================================
    // STEP 5: CHECK OWNERSHIP
    // ============================================
    if (post.user_id !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts',
        code: 403,
      });
    }

    // ============================================
    // STEP 6: CHECK STATUS (Hanya pending yang bisa delete)
    // ============================================
    if (post.status !== 'pending') {
      return res.status(403).json({
        success: false,
        message: `Cannot delete post with status '${post.status}'. Only pending posts can be deleted.`,
        code: 403,
      });
    }

    // ============================================
    // STEP 7: DELETE POST (cascade delete images)
    // ============================================
    // CASCADE DELETE di database otomatis delete post_images
    await query('DELETE FROM posts WHERE post_id = ?', [post_id]);

    // ============================================
    // STEP 8: LOG ACTIVITY
    // ============================================
    await query(
      `INSERT INTO activity_logs (user_id, action, resource_type, resource_id, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.user_id,
        'delete_post',
        'posts',
        post_id,
        req.headers['x-forwarded-for'] || 'unknown',
        req.headers['user-agent'] || 'unknown',
      ]
    );

    // ============================================
    // STEP 9: RETURN SUCCESS RESPONSE
    // ============================================
    return res.status(200).json({
      success: true,
      message: 'Post deleted successfully',
      code: 200,
    });
  } catch (error) {
    console.error('Delete post error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Failed to delete post.',
      code: 500,
    });
  }
};
