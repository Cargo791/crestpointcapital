import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import multer from "multer";
import nodemailer from "nodemailer";
import axios from "axios"

dotenv.config();

// ✅ USE THIS INSTEAD
let priceCache = null;

// Fetch function
async function fetchPrices() {
  try {
    const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: {
        ids: "bitcoin,ethereum,solana,binancecoin",
        vs_currencies: "usd",
      },
    });
    priceCache = response.data;
    console.log("✅ Crypto prices updated:", priceCache);
  } catch (error) {
    console.error("❌ Failed to fetch prices:", error.message);
    // Keep old priceCache if fetch fails
  }
}

// Refresh prices every 2 minutes
fetchPrices(); // Initial call
setInterval(fetchPrices, 2 * 60 * 1000); // Every 2 mins

// Use this in your routes
function getCryptoPricesCached() {
  return priceCache;
}

const app = express();
app.set("view engine", "ejs")
const port = process.env.PORT || 3000
const __filename = fileURLToPath (import.meta.url)
const __dirname = path.dirname(__filename)
//const prices = await getCryptoPrices()



const upload = multer();




// Force IPv4
const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false,
  },
  family: 4,
});
db.query("SELECT NOW()")
  .then(() => console.log("✅ Connected to database"))
  .catch(err => console.error("❌ Failed to connect to database:", err.stack));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "your-secret",
  resave: false,
  saveUninitialized: true,
}));



app.get("/", (req, res) => {
  res.render("home.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});


// GET reset password page
app.get("/forgot-password", (req, res) => {
  res.render("forgot-password"); // forgot-password.ejs
});


app.get('/secrets', async (req, res) => {
  const userEmail = req.session.user_email;

  if (!userEmail) {
    return res.redirect('/login');
  }

  try {
    const userResult = await db.query("SELECT * FROM users WHERE email = $1", [userEmail]);
    const user = userResult.rows[0];

    if (!user) return res.send("❌ User not found.");

    // Fetch crypto balances
    const btc = parseFloat(user.btc_balance) || 0;
    const eth = parseFloat(user.eth_balance) || 0;
    const sol = parseFloat(user.sol_balance) || 0;
    const bnb = parseFloat(user.bnb_balance) || 0;

    // Fetch transactions
    const txResult = await db.query(
      "SELECT * FROM transactions WHERE email = $1 ORDER BY created_at DESC",
      [userEmail]
    );
    const transactions = txResult.rows;

    const prices = getCryptoPricesCached();
    // Use user fields for deposit, profit, withdrawal or set 0 as fallback
    res.render('secrets', {
      name: user.full_name,
      email: user.email,
      balance: user.balance || 0,
      paymentStatus: user.payment_status || 'none',
      btc: btc,
      eth: eth,
      sol: sol,
      bnb: bnb,
      transactions: transactions,  // plural here, to match your ejs
      deposit: parseFloat(user.deposit_btc) || 0,
      profit: parseFloat(user.profit_btc) || 0,
      withdrawal: parseFloat(user.withdrawal_btc) || 0,
      prices: prices,
      message: null
    });
  } catch (error) {
    console.error("Database error:", error);
    res.send("❌ Failed to fetch balance.");
  }
});

     
 app.post("/register", async (req, res) => {
  const name = req.body.name;
  const email = req.body.email;
  const password = req.body.password;
  const country = req.body.country;
  const phone = req.body.phone;

  console.log("➡️ Register attempt:", { name, email, password, phone, country });

  try {
    console.log("🔍 Checking if user exists...");
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    console.log("✅ Check complete:", checkResult.rows.length);

    if (checkResult.rows.length > 0) {
      return res.send("Email already exists. Try logging in.");
    } // ✅ ← THIS WAS MISSING

    console.log("📝 Inserting new user...");
    const result = await db.query(
      "INSERT INTO users (email, password, full_name) VALUES ($1, $2, $3) RETURNING *",
      [email, password, name]
    );

    const user = result.rows[0];
    const deposit = 0;

    const btc_balance = parseFloat(user.btc_balance) || 0;
    const sol_balance = parseFloat(user.sol_balance) || 0;
    const eth_balance = parseFloat(user.eth_balance) || 0;
    const bnb_balance = parseFloat(user.bnb_balance) || 0;


    await db.query(
  "INSERT INTO transactions (email, full_name, coin_type, amount, type, package, status, receipt_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
  [email, name, 'N/A', 0, 'N/A', 'N/A', 'N/A', null]
);

await db.query(
  "INSERT INTO deposits (email, full_name, coin, amount, pkg, status) VALUES ($1, $2, $3, $4, $5, $6)",
  [email, name, 'N/A', 0, 'N/A', 'registered']
);
    console.log("✅ Inserted user:", user);

    res.render("secrets.ejs", {
      name: user.full_name,
      email: user.email,
      balance: user.balance || 0,
      paymentStatus: 'none',
      btc: btc_balance,
      deposit: deposit,
      sol: sol_balance,
      eth: eth_balance,
      bnb: bnb_balance,
      btcAmount: null,
      btcAddress: null,
      solAmount: null,
      solAddress: null,
      ethAmount: null,
      ethAddress: null,
      bnbAmount: null,
      bnbAddress: null,
      prices: {},
      profit: 0,
      withdrawal: 0,
      transactions: [],
      message: null
    });

  } catch (err) {
    console.error("❌ REGISTER ERROR:", err.stack);
    res.status(500).send("Server error: " + err.message);
  }
});

app.post("/login", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  console.log("➡️ Login attempt:", { email, password });

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    console.log("🔍 User lookup result:", result.rows);

    if (result.rows.length > 0) {
      const user = result.rows[0];

      if (password === user.password) {
        req.session.user_email = user.email;

        const prices = getCryptoPricesCached();

        const btc_balance = parseFloat(user.btc_balance) || 0;
        const sol_balance = parseFloat(user.sol_balance) || 0;
        const eth_balance = parseFloat(user.eth_balance) || 0;
        const bnb_balance = parseFloat(user.bnb_balance) || 0;

        const transactionsResult = await db.query(
          "SELECT * FROM transactions WHERE email = $1 ORDER BY created_at DESC",
          [user.email]
        );
        const transactions = transactionsResult.rows || [];

        const depositResult = await db.query(
  "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE email = $1",
  [user.email]
);
const depositTotal = parseFloat(depositResult.rows[0].total) || 0;

        res.render("secrets.ejs", {
          name: user.full_name,
          email: user.email,
          balance: user.balance || 0,
          paymentStatus: user.payment_status || "none",
          btc: btc_balance,
          deposit: depositTotal,
          sol: sol_balance,
          eth: eth_balance,
          bnb: bnb_balance,
          btcAmount: null,
          btcAddress: null,
          solAmount: null,
          solAddress: null,
          ethAmount: null,
          ethAddress: null,
          bnbAmount: null,
          bnbAddress: null,
          prices: prices,
          profit: parseFloat(user.profit_btc) || 0,
          withdrawal: parseFloat(user.withdrawal_btc) || 0,
          transactions: transactions,
          message: null
        });
      } else {
        console.log("❌ Incorrect password");
        res.send("Incorrect Password");
      }
    } else {
      console.log("❌ User not found");
      res.send("User not found");
    }
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);
    res.status(500).send("Server error: " + err.message);
  }
});




app.post('/upload-receipt', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.send('❌ No file uploaded.');
  }

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: 'growwvest@gmail.com', // replace with your email
    subject: '🧾 New Payment Receipt Uploaded',
    text: 'A user has submitted a payment receipt.',
    attachments: [
      {
        filename: req.file.originalname,
        content: req.file.buffer.toString("base64"),
        encoding: "base64",
      }
    ]
  };

  try {
    await transporter.sendMail(mailOptions);
    res.send('✅ Receipt uploaded and email sent successfully!');
  } catch (err) {
    console.error("❌ Email sending failed:", err);
    res.status(500).send('❌ Failed to send email: ' + err.message);
  }
});

app.post("/start-btc-payment", async (req, res) => {
  const { email, amount } = req.body;

  try {
    // Update user status to 'processing'
    await db.query(
      "UPDATE users SET payment_status = 'processing' WHERE email = $1",
      [email]
    );

    const user = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    res.render("secrets.ejs", {
      name: user.rows[0].full_name,
      email: user.rows[0].email,
      balance: user.rows[0].balance,
      paymentStatus: 'processing',
      btcAmount: amount,
      message: null,
      btcAddress: "bc1q87yng5l9kyl7390gm80nreq2qmw3v7f0ryx699"
    });

  } catch (err) {
    console.error(err);
    res.send("Error starting BTC payment.");
  }
});

app.post("/start-sol-payment", async (req, res) => {
  const { email, amount } = req.body;

  try {
    // Update user status to 'processing'
    await db.query(
      "UPDATE users SET payment_status = 'processing' WHERE email = $1",
      [email]
    );

    const user = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    res.render("secrets.ejs", {
      name: user.rows[0].full_name,
      email: user.rows[0].email,
      balance: user.rows[0].balance,
      paymentStatus: 'processing',
      solAmount: amount,
      message: null,
      solAddress: "9D8d3DL9sYSHU9VVnateJEeosKg31MZNPNMJxMWkAs13"
    });

  } catch (err) {
    console.error(err);
    res.send("Error starting SOL payment.");
  }
});

app.post("/start-bnb-payment", async (req, res) => {
  const { email, amount } = req.body;

  try {
    // Update user status to 'processing'
    await db.query(
      "UPDATE users SET payment_status = 'processing' WHERE email = $1",
      [email]
    );

    const user = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    res.render("secrets.ejs", {
      name: user.rows[0].full_name,
      email: user.rows[0].email,
      balance: user.rows[0].balance,
      paymentStatus: 'processing',
      bnbAmount: amount,
      message: null,
      bnbAddress: "0x497785495154a4D919Cd0aA047Fc23a778bd6337"
    });

  } catch (err) {
    console.error(err);
    res.send("Error starting BNB payment.");
  }
});


app.post("/start-eth-payment", (req, res) => {
  const { email, amount } = req.body;
  console.log("Form Data:", email, amount);

  res.render("secrets.ejs", {
    name: "Test User",
    email,
    balance: "0",
    paymentStatus: "processing",
    ethAmount: amount,
    message: null,
    ethAddress: "0x497785495154a4D919Cd0aA047Fc23a778bd6337",
  });
});

app.get('/withdraw', async (req, res) => {
    if (!req.session.user_email) return res.redirect('/login');
    res.render('withdraw', { message: null });
});

app.post('/withdraw', async (req, res) => {
    const { coin_type, address } = req.body;
    const email = req.session.user_email;

    try {
        // Count completed deposit transactions by email
        const result = await db.query(
            'SELECT COUNT(*) FROM transactions WHERE email = $1 AND type = $2',
            [email, 'deposit']
        );

        const txCount = parseInt(result.rows[0].count);

        if (txCount < 2) {
            return res.render('withdraw', {
                message: `You need to complete at least 2 deposit transactions before withdrawing.`
            });
        }

        // Record the withdrawal request
        await db.query(
            'INSERT INTO transactions (email, type, coin_type, address, amount) VALUES ($1, $2, $3, $4, $5)',
            [email, 'withdrawal', coin_type, address, 0] // Replace 0 with actual amount if needed
        );

        res.render('withdraw', {
            message: 'Withdrawal request submitted successfully!'
        });

    } catch (err) {
        console.error(err);
        res.render('withdraw', {
            message: 'Something went wrong. Please try again.'
        });
    }
});

app.post("/approve-payment", async (req, res) => {
  const { email, amount } = req.body;

  try {
    // Update balance and mark payment as confirmed
    await db.query("UPDATE users SET balance = balance + $1, payment_status = 'confirmed' WHERE email = $2", [
      amount,
      email
    ]);

    const updatedUser = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    const prices = getCryptoPricesCached();
    res.render("secrets.ejs", {
      name: updatedUser.rows[0].full_name,
      email: updatedUser.rows[0].email,
      message: null,
      balance: updatedUser.rows[0].balance,
      paymentStatus: 'confirmed'
    });

  } catch (err) {
    console.error(err);
    res.send("Error approving payment.");
  }
});


  

app.post('/deposit', async (req, res) => {
  const { coin, amount, pkg } = req.body;
  const email = req.session.user_email;

  try {
    await db.query(
      'INSERT INTO deposits (email, coin, amount, pkg, status) VALUES ($1, $2, $3, $4, $5)',
      [email, coin, amount, pkg, 'processing']
    );

    res.redirect('/secrets');
  } catch (err) {
    console.error(err);
    res.send('❌ Deposit failed');
  }
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  // Check if user exists
  const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  if (result.rows.length === 0) {
    return res.send("No account with that email.");
  }

  // 🛠️ Here you would:
  // - Generate a secure reset token
  // - Save it in DB with expiry
  // - Email a reset link to user
  // e.g., /reset-password?token=abcd123

  res.send("Password reset instructions have been sent to your email (simulated).");
});




// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME,  // from .env
    pass: process.env.EMAIL_PASS   // from .env
  }
});
app.post('/submit-transaction', async (req, res) => {
  const { email, coin_type, amount, type, pkg, receipt_url } = req.body;

  try {
    await db.query(
      'INSERT INTO transactions (email, coin_type, amount, type, package, status, receipt_url) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [email, coin_type, amount, type, pkg, 'processing', receipt_url]
    );

    res.send('✅ Transaction submitted successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Failed to submit transaction.');
  }
});
app.get('/transaction-history', async (req, res) => {
  const userEmail = req.session.user_email;

  if (!userEmail) {
    return res.redirect('/login');
  }

  try {
    const result = await db.query(
      'SELECT * FROM transactions WHERE email = $1 ORDER BY created_at DESC',
      [userEmail]
    );

    res.render('transaction-history', { transactions: result.rows });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).send("Server error");
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
      return res.redirect('/home'); // or home page
    }
    res.clearCookie('connect.sid'); // Optional: clears session cookie
    res.redirect('/login'); // Or wherever your login page is
  });
});



 
app.post("/change-password", async (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  const userEmail = req.session.user_email; // ✅ fixed

  if (!userEmail) return res.redirect("/login");

  if (newPassword !== confirmPassword) {
    return res.render("secrets", {
      errorMessage: "Passwords do not match.",
      successMessage: null,
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10); // ✅ requires import

    await db.query( // ✅ use "db", not "pool"
      "UPDATE users SET password = $1 WHERE email = $2",
      [hashedPassword, userEmail]
    );

    return res.render("secrets", {
      successMessage: "Password updated successfully.",
      errorMessage: null,
    });
  } catch (error) {
    console.error("❌ Password change error:", error);
    return res.render("secrets", {
      errorMessage: "Error updating password.",
      successMessage: null,
    });
  }
});
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
