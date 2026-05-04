// /config/db.js
/**
 * DATABASE CONNECTION POOL CONFIGURATION
 * 
 * Menggunakan mysql2/promise untuk async/await support
 * Connection pool otomatis manage koneksi, recycle, dan cleanup
 * 
 * Alur:
 * 1. Load env variables (TiDB credentials)
 * 2. Create pool dengan max 10 connections (Vercel limit)
 * 3. Test koneksi saat startup
 * 4. Export pool untuk dipakai di setiap API endpoint
 */

const mysql = require('mysql2/promise');

// Pool configuration - SINGLETON PATTERN
// Hanya dibuat 1x per cold start, di-reuse setiap request
let pool = null;

const getPool = async () => {
  if (pool) {
    return pool; // Return existing pool jika sudah ada
  }

  // ============================================
  // VALIDASI ENVIRONMENT VARIABLES
  // ============================================
  const requiredEnvVars = [
    'TIDB_HOST',
    'TIDB_PORT',
    'TIDB_DATABASE',
    'TIDB_USER',
    'TIDB_PASSWORD',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // ============================================
  // CREATE CONNECTION POOL
  // ============================================
  pool = await mysql.createPool({
    host: process.env.TIDB_HOST,
    port: parseInt(process.env.TIDB_PORT, 10),
    database: process.env.TIDB_DATABASE,
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    
    // TiDB Serverless specific settings
    ssl: process.env.TIDB_ENABLE_SSL === 'true' ? 'amazon' : false,
    waitForConnections: true,
    connectionLimit: 10,  // Max 10 connections (Vercel limit)
    queueLimit: 0,        // Unlimited queue waiting
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 0,
    decimalNumbers: true, // Handle decimal values properly
    timezone: '+00:00',   // UTC timezone
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  // ============================================
  // TEST KONEKSI
  // ============================================
  try {
    const connection = await pool.getConnection();
    const result = await connection.query('SELECT 1 AS test');
    connection.release();
    console.log('✅ TiDB Connection Pool established successfully');
  } catch (error) {
    console.error('❌ Failed to connect to TiDB:', error.message);
    pool = null;
    throw error;
  }

  return pool;
};

/**
 * EXECUTE QUERY WRAPPER
 * 
 * Alur:
 * 1. Get pool
 * 2. Acquire connection dari pool
 * 3. Execute query dengan prepared statement (prevent SQL injection)
 * 4. Release connection ke pool
 * 5. Return hasil query
 * 
 * Error handling: Automatic - jika error, connection di-destroy & buat baru
 */
const query = async (sql, values = []) => {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    // Prepared statement: ? placeholder di-replace dengan values
    // MySQL library otomatis escape values & prevent SQL injection
    const [rows] = await connection.execute(sql, values);
    return rows;
  } catch (error) {
    console.error('Database query error:', {
      sql,
      values,
      error: error.message,
    });
    throw error;
  } finally {
    // CRITICAL: Release connection kembali ke pool
    connection.release();
  }
};

/**
 * EXECUTE QUERY WITH TRANSACTION
 * 
 * Alur:
 * 1. Get connection
 * 2. BEGIN transaction
 * 3. Execute multiple queries
 * 4. COMMIT jika semua sukses
 * 5. ROLLBACK jika ada error
 * 
 * Gunakan untuk operasi multi-step yang harus atomic (all-or-nothing)
 * Contoh: Create post + insert images + update user stats
 */
const transaction = async (callback) => {
  const pool = await getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * CLOSE POOL (untuk graceful shutdown)
 * Gunakan di vercel.json atau cleanup hooks
 */
const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Connection pool closed');
  }
};

module.exports = {
  getPool,
  query,
  transaction,
  closePool,
};