import pg from "pg";

const { Pool } = pg;

let pool = null;
let isConnected = false;
let initPromise = null;

if (process.env.DATABASE_URL) {
  const connectionString = process.env.DATABASE_URL;
  const isCloudDb = process.env.NODE_ENV === "production" || 
                    connectionString.includes("sslmode=require") || 
                    connectionString.includes("render") || 
                    connectionString.includes("supabase") || 
                    connectionString.includes("neon") || 
                    connectionString.includes("cockroach") ||
                    connectionString.includes("railway");

  pool = new Pool({
    connectionString,
    ssl: isCloudDb ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000
  });
}

export function getPool() {
  return pool;
}

export async function initDb() {
  if (isConnected) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!pool) {
      console.log("[Database Notice] No DATABASE_URL provided. Using memory store.");
      return false;
    }

    try {
      const client = await pool.connect();
      client.release();
      isConnected = true;
      console.log("[PostgreSQL Connected] Successfully connected to PostgreSQL database.");

      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(255) PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          is_email_verified BOOLEAN DEFAULT FALSE,
          verification_token VARCHAR(255),
          reset_password_token VARCHAR(255),
          reset_password_expires BIGINT
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(500) NOT NULL,
          category VARCHAR(255) NOT NULL,
          author VARCHAR(255) NOT NULL,
          is_verified BOOLEAN DEFAULT FALSE,
          cover_image TEXT,
          content TEXT NOT NULL,
          created_at VARCHAR(255) NOT NULL,
          read_time VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'published'
        );
      `);

      await pool.query(`
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'published';
      `);

      return true;
    } catch (err) {
      console.log("[PostgreSQL Connection Error]:", err.message);
      console.log("[PostgreSQL Fallback] Falling back to in-memory data store.");
      isConnected = false;
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function query(text, params) {
  if (!pool) return null;
  if (!isConnected) {
    await initDb();
  }
  if (!isConnected) return null;
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("[PostgreSQL Query Error]:", err.message);
    return null;
  }
}

export function isDbConnected() {
  return isConnected;
}
