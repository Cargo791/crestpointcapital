import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function testDB() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ DB connected:', res.rows[0]);
  } catch (err) {
    console.error('❌ DB connection failed:', err);
  } finally {
    await pool.end();
  }
}

testDB();
