const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files directly from root directory
app.use(express.static(__dirname));

// -------------------------------------------------------------
// Database Connection (MongoDB)
// -------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/kds_esports";
mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

// -------------------------------------------------------------
// Nodemailer Email Transporter Setup
// -------------------------------------------------------------
const ADMIN_EMAIL = "its.kds.dev@gmail.com";
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: ADMIN_EMAIL,
    pass: process.env.EMAIL_PASSWORD || 'your-app-password-here'
  }
});

// Helper Function: Send Emails safely
const sendEmail = async (to, subject, htmlContent) => {
  try {
    await transporter.sendMail({
      from: `"KDS Esports" <${ADMIN_EMAIL}>`,
      to: to,
      subject: subject,
      html: htmlContent
    });
    console.log(`Email successfully sent to: ${to}`);
  } catch (error) {
    console.error(`Email sending failed to ${to}:`, error.message);
  }
};

// -------------------------------------------------------------
// Schemas & Models
// -------------------------------------------------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  dob: { type: Date, required: true },
  referralCode: { type: String, default: "" },
  walletBalance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// -------------------------------------------------------------
// Age Calculation Helper Function
// -------------------------------------------------------------
function calculateAge(dobString) {
  const birthDate = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. PLAYER REGISTRATION
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, mobile, password, dob, referralCode } = req.body;

    if (!username || !email || !mobile || !password || !dob) {
      return res.status(400).json({ success: false, message: "All required fields must be filled." });
    }

    // Strict Age Check: Minimum 10 Years
    const age = calculateAge(dob);
    if (age < 10) {
      return res.status(400).json({ 
        success: false, 
        message: "Registration failed: Player must be at least 10 years old." 
      });
    }

    // Check Duplicate Account
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email or Mobile Number already registered." });
    }

    // Optional Referral Bonus
    const initialWallet = referralCode ? 10 : 0;

    const newUser = new User({
      username,
      email,
      mobile,
      password,
      dob: new Date(dob),
      referralCode,
      walletBalance: initialWallet
    });

    await newUser.save();

    // Mail to Player
    const playerMailHtml = `
      <h2>Welcome to KDS Esports, ${username}!</h2>
      <p>Your registration was successful.</p>
      <ul>
        <li><b>Email:</b> ${email}</li>
        <li><b>Mobile:</b> ${mobile}</li>
        <li><b>Initial Wallet Balance:</b> ₹${initialWallet}</li>
      </ul>
    `;
    sendEmail(email, "Welcome to KDS Esports", playerMailHtml);

    // Alert Mail to Admin
    const adminMailHtml = `
      <h2>New Player Registration Alert!</h2>
      <ul>
        <li><b>Name:</b> ${username}</li>
        <li><b>Email:</b> ${email}</li>
        <li><b>Mobile:</b> ${mobile}</li>
        <li><b>Date of Birth:</b> ${new Date(dob).toDateString()} (Age: ${age})</li>
        <li><b>Referral:</b> ${referralCode || "None"}</li>
      </ul>
    `;
    sendEmail(ADMIN_EMAIL, `New Registration: ${username}`, adminMailHtml);

    return res.status(201).json({ 
      success: true, 
      message: "Registration successful!",
      user: { id: newUser._id, username: newUser.username, walletBalance: newUser.walletBalance }
    });

  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ success: false, message: "Internal server error during registration." });
  }
});

// 2. DUAL LOGIN (Email or Mobile)
app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
      password: password
    });

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    res.json({
      success: true,
      message: "Login successful!",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        mobile: user.mobile,
        walletBalance: user.walletBalance
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error during login." });
  }
});

// 3. FORGOT PASSWORD
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Please enter your email." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email not found." });
    }

    const resetMailHtml = `
      <h2>Password Recovery - KDS Esports</h2>
      <p>Hello <b>${user.username}</b>,</p>
      <p>Your password is: <b style="color: #e63946;">${user.password}</b></p>
    `;

    await sendEmail(user.email, "Password Recovery - KDS Esports", resetMailHtml);
    res.json({ success: true, message: "Password sent to your email!" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send email." });
  }
});

// -------------------------------------------------------------
// Page Routes (Root Directory Handling)
// -------------------------------------------------------------
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server Listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server active on Port ${PORT}`);
});
