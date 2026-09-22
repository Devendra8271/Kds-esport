const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

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
    pass: process.env.EMAIL_PASSWORD || 'your-app-password-here' // Render Environment Variables me APP PASSWORD set karein
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

    // 10 Years Minimum Age Validation
    const age = calculateAge(dob);
    if (age < 10) {
      return res.status(400).json({ 
        success: false, 
        message: "Registration failed: Player must be at least 10 years old." 
      });
    }

    // Existing User Check
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email or Mobile Number already registered." });
    }

    // Bonus balance if referral code used
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

    // EMAIL ALERT 1: To Player (Welcome Mail)
    const playerMailHtml = `
      <h2>Welcome to KDS Esports, ${username}!</h2>
      <p>Your account has been created successfully.</p>
      <ul>
        <li><b>Email:</b> ${email}</li>
        <li><b>Mobile:</b> ${mobile}</li>
        <li><b>Initial Wallet Balance:</b> ₹${initialWallet}</li>
      </ul>
      <p>Good luck for your tournaments!</p>
    `;
    sendEmail(email, "Welcome to KDS Esports - Registration Successful", playerMailHtml);

    // EMAIL ALERT 2: To Admin (Data Alert)
    const adminMailHtml = `
      <h2>New Player Registration Alert!</h2>
      <p>A new player has registered on KDS Esports platform:</p>
      <ul>
        <li><b>Name:</b> ${username}</li>
        <li><b>Email:</b> ${email}</li>
        <li><b>Mobile:</b> ${mobile}</li>
        <li><b>Date of Birth:</b> ${new Date(dob).toDateString()} (Age: ${age})</li>
        <li><b>Referral Code Used:</b> ${referralCode || "None"}</li>
        <li><b>Registration Date:</b> ${new Date().toLocaleString()}</li>
      </ul>
    `;
    sendEmail(ADMIN_EMAIL, `New Player Alert: ${username}`, adminMailHtml);

    return res.status(201).json({ 
      success: true, 
      message: "Registration successful! Confirmation emails sent.",
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
    const { identifier, password } = req.body; // identifier can be email or mobile

    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
      password: password
    });

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid Email/Mobile or Password." });
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

// 3. FORGOT PASSWORD (EMAIL DELIVERY)
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Please provide your email address." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(440).json({ success: false, message: "No account found with this email address." });
    }

    const resetMailHtml = `
      <h2>Password Recovery - KDS Esports</h2>
      <p>Hello <b>${user.username}</b>,</p>
      <p>You requested your account password recovery details:</p>
      <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; font-size: 16px;">
        <p><b>Your Account Password:</b> <span style="color: #e63946; font-weight: bold;">${user.password}</span></p>
      </div>
      <p>Please log in and change your password if needed.</p>
    `;

    await sendEmail(user.email, "KDS Esports - Account Password Recovery", resetMailHtml);

    res.json({ success: true, message: "Password reset details have been sent to your email!" });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ success: false, message: "Failed to send recovery email. Try again later." });
  }
});

// Serve Admin Panel Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve Root Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server Listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server active on Port ${PORT}`);
});
