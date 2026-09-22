const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// Configuration Constants
const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";
const ADMIN_EMAIL = "its.kds.dev@gmail.com";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwk1G8-N-XBpyq59ZRoMZ5S1CcPblaErbglJLxe7SG_0TFdQlZYoLETuOR_j1Gp08gr/exec";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Gmail Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'ecfz ymiu gcoj lsis'
    }
});

// Mongo Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("DB Error:", err));

// Schemas & Models
const UserSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    name: { type: String, required: true },
    dob: { type: String, required: true },
    gender: { type: String, default: "Male" },
    password: { type: String, required: true },
    walletBalance: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    referralCode: { type: String, required: true },
    referredBy: { type: String, default: null },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Age Checker Helper
function calculateAge(dobString) {
    const today = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

// 1. REGISTER PLAYER
app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referredBy } = req.body;
        if (!name || !email || !mobile || !dob || !password) {
            return res.status(400).json({ success: false, message: "Sabhi details bharna zaroori hai!" });
        }

        if (calculateAge(dob) < 10) {
            return res.status(400).json({ success: false, message: "Minimum age requirement is 10 years!" });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanMobile = mobile.trim();

        const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { mobile: cleanMobile }] });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email ya Mobile number pehle se registered hai!" });
        }

        const referCode = "REF" + Math.floor(100000 + Math.random() * 900000);
        const newUser = new User({
            identifier: cleanEmail,
            email: cleanEmail,
            mobile: cleanMobile,
            name,
            dob,
            gender: gender || "Male",
            password,
            referralCode: referCode,
            referredBy: referredBy ? referredBy.trim() : null
        });

        await newUser.save();

        // 1. Mail to Player
        const playerMail = {
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: cleanEmail,
            subject: '🎮 Registration Successful - KDS E-sport',
            html: `<h3>Welcome ${name}!</h3><p>Aapka registration successfully ho gaya hai.</p><p><b>Referral Code:</b> ${referCode}</p>`
        };

        // 2. Mail to Admin
        const adminMail = {
            from: 'KDS Alert <its.kds.dev@gmail.com>',
            to: ADMIN_EMAIL,
            subject: '🔔 New Registration Alert',
            html: `<h3>New Player Details</h3><p><b>Name:</b> ${name}</p><p><b>Email:</b> ${cleanEmail}</p><p><b>Mobile:</b> ${cleanMobile}</p>`
        };

        transporter.sendMail(playerMail);
        transporter.sendMail(adminMail);

        // Google Apps Script Sync
        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: "REGISTRATION", name, email: cleanEmail, mobile: cleanMobile, dob, gender, referralCode: referCode })
            });
        } catch (e) { console.error("Script Sync Error:", e.message); }

        res.json({ success: true, message: "Registration successful! Emails sent." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 2. LOGIN (Email OR Mobile)
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const cleanInput = identifier.trim().toLowerCase();

        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }] });
        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Wrong Email/Mobile or Password!" });
        }
        if (user.isBanned) {
            return res.status(403).json({ success: false, message: "Your account is banned." });
        }

        res.json({ success: true, user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 3. FORGOT PASSWORD (Reset Link to Email)
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }] });

        if (!user) return res.status(404).json({ success: false, message: "Account not found!" });

        const token = crypto.randomBytes(20).toString('hex');
        user.resetToken = token;
        user.resetTokenExpires = Date.now() + 15 * 60 * 1000;
        await user.save();

        const resetLink = `${BASE_URL}/index.html?resetToken=${token}`;

        const resetMail = {
            from: 'KDS Support <its.kds.dev@gmail.com>',
            to: user.email,
            subject: '🔑 Password Reset Link',
            html: `<p>Password reset karne ke liye niche link par click karein:</p><a href="${resetLink}">${resetLink}</a>`
        };

        transporter.sendMail(resetMail, (err) => {
            if (err) return res.status(500).json({ success: false, message: "Mail send failed" });
            res.json({ success: true, message: "Reset link emailed successfully!" });
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log("Server Running on Port 3000"));
