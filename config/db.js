import pg from "pg";
import bcrypt from "bcrypt";

const { Pool } = pg;

let pool = null;
let isConnected = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 3000
  });
}

export function getPool() {
  return pool;
}

export async function query(text, params) {
  if (!pool || !isConnected) return null;
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("[PostgreSQL Query Error]:", err.message);
    return null;
  }
}

export async function initDb() {
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
        read_time VARCHAR(255) NOT NULL
      );
    `);

    const userCount = await pool.query("SELECT COUNT(*) FROM users;");
    if (parseInt(userCount.rows[0].count, 10) === 0) {
      const hashedAdminPass = await bcrypt.hash("password123", 10);
      await pool.query(
        `INSERT INTO users (id, username, email, password, is_email_verified)
         VALUES ($1, $2, $3, $4, $5);`,
        ["admin-user-uuid", "AlexRivers", "alex@example.com", hashedAdminPass, true]
      );
    }

    const postCount = await pool.query("SELECT COUNT(*) FROM posts;");
    if (parseInt(postCount.rows[0].count, 10) === 0) {
      await pool.query(
        `INSERT INTO posts (id, title, category, author, is_verified, cover_image, content, created_at, read_time)
         VALUES 
         ($1, $2, $3, $4, $5, $6, $7, $8, $9),
         ($10, $11, $12, $13, $14, $15, $16, $17, $18),
         ($19, $20, $21, $22, $23, $24, $25, $26, $27);`,
        [
          "post-uuid-1", "Building Modern Web Applications with Express & Glassmorphism", "Development", "AlexRivers", true, "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80", "Web development has evolved drastically over the past few years. Modern interfaces prioritize visual aesthetics, responsive performance, and seamless interactive user experiences.", "Aug 3, 2026", "3 min read",
          "post-uuid-2", "The Future of AI-Assisted Pair Programming", "Technology", "Elena Rostova", false, "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80", "Artificial intelligence is changing the software engineering landscape rapidly. Rather than replacing developers, AI tools serve as supercharged pair programmers.", "Aug 2, 2026", "2 min read",
          "post-uuid-3", "Mastering UI Design: Micro-Animations & Contrast", "Design", "Marcus Vance", false, "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80", "Micro-animations are subtle visual feedback moments that make a digital product feel responsive, fluid, and alive.", "Jul 28, 2026", "2 min read"
        ]
      );
    }

    return true;
  } catch (err) {
    console.log("[PostgreSQL Connection Notice] Could not connect to PostgreSQL server at DATABASE_URL:", err.message);
    console.log("[PostgreSQL Fallback] Falling back to in-memory data store.");
    isConnected = false;
    return false;
  }
}

export function isDbConnected() {
  return isConnected;
}
