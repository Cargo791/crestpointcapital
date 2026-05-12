import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import nodemailer from "nodemailer";
import axios from "axios";
import bcrypt from "bcryptjs";

dotenv.config();

// ================= APP =================
const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
  })
);

const upload = multer();

// ================= DB (SUPABASE POSTGRES) =================
const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

db.query("SELECT NOW()")
  .then(() => console.log("✅ DB Connected"))
  .catch((err) => console.log("❌ DB Error:", err.message));

// ================= CRYPTO PRICES =================
let priceCache = null;

async function fetchPrices() {
  try {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: "bitcoin,ethereum,solana,binancecoin",
          vs_currencies: "usd",
        },
      }
    );
    priceCache = res.data;
  } catch (err) {
    console.log("Price error:", err.message);
  }
}

fetchPrices();
setInterval(fetchPrices, 120000);

const getPrices = () => priceCache;

// ================= ROUTES =================
app.get("/", (req, res) => res.render("home"));
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));

// ================= REGISTER =================
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const check = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (check.rows.length > 0) {
      return res.send("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      "INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [name, email, hashedPassword]
    );

    req.session.user_email = email;

    res.redirect("/secrets");
  } catch (err) {
    console.log(err);
    res.send("Register error");
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.send("User not found");
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.send("Incorrect Password");
    }

    req.session.user_email = user.email;

    res.redirect("/secrets");
  } catch (err) {
    console.log(err);
    res.send("Login error");
  }
});

// ================= DASHBOARD =================
app.get("/secrets", async (req, res) => {
  const email = req.session.user_email;

  if (!email) return res.redirect("/login");

  try {
    const userRes = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = userRes.rows[0];

    const txRes = await db.query(
      "SELECT * FROM transactions WHERE email = $1 ORDER BY created_at DESC",
      [email]
    );

    const depRes = await db.query(
      "SELECT COALESCE(SUM(amount),0) as total FROM deposits WHERE email = $1",
      [email]
    );

    res.render("secrets", {
      name: user.full_name,
      email: user.email,
      balance: user.balance,
      btc: user.btc_balance,
      eth: user.eth_balance,
      sol: user.sol_balance,
      bnb: user.bnb_balance,
      deposit: depRes.rows[0].total,
      profit: user.profit_btc,
      withdrawal: user.withdrawal_btc,
      transactions: txRes.rows,
      prices: getPrices(),
    });
  } catch (err) {
    console.log(err);
    res.send("Dashboard error");
  }
});

// ================= DEPOSIT =================
app.post("/deposit", async (req, res) => {
  const email = req.session.user_email;
  const { coin, amount, pkg } = req.body;

  if (!email) return res.redirect("/login");

  try {
    await db.query(
      "INSERT INTO deposits (email, coin, amount, pkg, status) VALUES ($1,$2,$3,$4,$5)",
      [email, coin, amount, pkg, "processing"]
    );

    res.redirect("/secrets");
  } catch (err) {
    console.log(err);
    res.send("Deposit error");
  }
});

// ================= WITHDRAW =================
app.post("/withdraw", async (req, res) => {
  const email = req.session.user_email;
  const { coin_type, address } = req.body;

  if (!email) return res.redirect("/login");

  try {
    const result = await db.query(
      "SELECT COUNT(*) FROM transactions WHERE email = $1 AND type = $2",
      [email, "deposit"]
    );

    const count = parseInt(result.rows[0].count);

    if (count < 2) {
      return res.send("Need 2 deposits before withdrawal");
    }

    await db.query(
      "INSERT INTO transactions (email, type, coin_type, address, amount) VALUES ($1,$2,$3,$4,$5)",
      [email, "withdrawal", coin_type, address, 0]
    );

    res.send("Withdrawal submitted");
  } catch (err) {
    console.log(err);
    res.send("Withdraw error");
  }
});

// ================= LOGOUT =================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ================= PASSWORD CHANGE =================
app.post("/change-password", async (req, res) => {
  const email = req.session.user_email;
  const { newPassword, confirmPassword } = req.body;

  if (!email) return res.redirect("/login");

  if (newPassword !== confirmPassword) {
    return res.send("Passwords do not match");
  }

  try {
    const hash = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE users SET password_hash = $1 WHERE email = $2",
      [hash, email]
    );

    res.send("Password updated");
  } catch (err) {
    console.log(err);
    res.send("Error updating password");
  }
});

// ================= START SERVER =================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
