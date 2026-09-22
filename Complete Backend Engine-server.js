const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";

// Nodemailer Transporter Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'your_app_password_here' // Gmail App Password yahan set karein
    }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

// --- SCHEMAS & MODELS ---

const UserSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true }, // Lowercase Email or Mobile
    mobile: { type: String, default: "" },
    email: { type: String, default: "" },
    name: { type: String, required: true },
    password: { type: String, required: true },
    dob: { type: String },
    gender: { type: String },
    walletBalance: { type: Number, default: 0 },
    referralCode: { type: String, required: true },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    notifications: [{ title: String, message: String, timestamp: { type: Date, default: Date.now } }],
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const SystemConfigSchema = new mongoose.Schema({
    appDownloadUrl: { type: String, default: "" },
    minWithdrawalLimit: { type: Number, default: 50 }
});
const SystemConfig = mongoose.model('SystemConfig', SystemConfigSchema);

const TournamentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    gameName: { type: String, required: true },
    matchMode: { type: String, default: "SOLO" },
    status: { type: String, default: "UPCOMING" },
    matchDate: { type: String, required: true },
    matchTime: { type: String, required: true },
    bannerUrl: { type: String, required: true },
    entryFee: { type: Number, required: true },
    totalSlots: { type: Number, default: 100 },
    upiId: { type: String, required: true },
    perKillPrize: { type: Number, default: 0 },
    rank1Prize: { type: Number, default: 0 },
    roomId: { type: String, default: "WAITING" },
    roomPass: { type: String, default: "WAITING" },
    registeredPlayers: [{
        identifier: String,
        username: String,
        gameId: String,
        utr: String,
        joinedAt: { type: Date, default: Date.now }
    }]
});
const Tournament = mongoose.model('Tournament', TournamentSchema);

async function getConfigs() {
    let config = await SystemConfig.findOne();
    if (!config) config = await SystemConfig.create({});
    return config;
}

// --- PLAYER AUTHENTICATION ROUTES ---

// 1. Registration Route
app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referralCode } = req.body;
        if (!name || !email || !mobile || !dob || !gender || !password) {
            return res.status(400).json({ success: false, message: "All required fields must be filled!" });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanMobile = mobile.trim();

        const existingUser = await User.findOne({
            $or: [{ identifier: cleanEmail }, { identifier: cleanMobile }, { email: cleanEmail }, { mobile: cleanMobile }]
        });

        if (existingUser) {
            return res.status(400).json({ success: false, message: "User with this email or mobile already exists!" });
        }

        const myReferralCode = "KDS" + Math.floor(100000 + Math.random() * 900000);

        const newUser = new User({
            identifier: cleanEmail,
            email: cleanEmail,
            mobile: cleanMobile,
            name,
            password,
            dob,
            gender,
            referralCode: myReferralCode,
            referredBy: referralCode || null
        });

        if (referralCode) {
            const referrer = await User.findOne({ referralCode: referralCode.trim() });
            if (referrer) {
                referrer.walletBalance += 10;
                referrer.referralCount += 1;
                await referrer.save();
                newUser.walletBalance += 5; // Bonus for joining via referral
            }
        }

        await newUser.save();
        res.json({ success: true, message: "Registration Successful! Please Login." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. Dual Login Route (Email or Mobile)
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Identifier and Password are required!" });
        }

        const cleanId = identifier.trim().toLowerCase();
        const user = await User.findOne({
            $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }]
        });

        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Invalid Credentials!" });
        }

        res.json({
            success: true,
            message: "Login Successful",
            user: {
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                identifier: user.identifier,
                walletBalance: user.walletBalance,
                referralCode: user.referralCode
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Forgot Password Route (Nodemailer via its.kds.dev@gmail.com)
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: "Email or Mobile is required!" });

        const cleanId = identifier.trim().toLowerCase();
        const user = await User.findOne({
            $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }]
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "No account found with these details!" });
        }

        const resetToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour validity
        await user.save();

        const resetUrl = `https://${req.headers.host}/reset-password?token=${resetToken}`;

        const mailOptions = {
            from: '"KDS E-Sport Support" <its.kds.dev@gmail.com>',
            to: user.email,
            subject: 'KDS E-Sport Password Reset Request',
            html: `
                <h3>Password Reset Request</h3>
                <p>Hello <b>${user.name}</b>,</p>
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetUrl}" style="padding:10px 15px; background:#00ff88; color:#000; text-decoration:none; font-weight:bold; border-radius:5px;">Reset Password</a>
                <br><br>
                <p>If you did not request this, please ignore this email.</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Email Error:", error);
                return res.status(500).json({ success: false, message: "Failed to send email. Check Nodemailer configurations." });
            }
            res.json({ success: true, message: `Password reset link sent to ${user.email}` });
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ADMIN SYSTEM CONTROL ROUTE ---

app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== ADMIN_SECRET) {
            return res.status(401).json({ success: false, message: "Invalid Admin Secret Key!" });
        }

        let config = await getConfigs();

        if (action === "UPDATE_APP_LINK") {
            config.appDownloadUrl = data.appDownloadUrl;
            await config.save();
            return res.json({ success: true, message: "App Download Link Updated Successfully!" });
        }

        if (action === "ADD_TOURNAMENT") {
            const count = await Tournament.countDocuments();
            const newT = new Tournament({
                id: "T" + (count + 101),
                gameName: data.gameName,
                matchMode: data.matchMode || "SOLO",
                status: "UPCOMING",
                matchDate: data.matchDate,
                matchTime: data.matchTime,
                bannerUrl: data.bannerUrl,
                entryFee: parseInt(data.entryFee),
                upiId: data.upiId,
                perKillPrize: parseInt(data.perKillPrize || 0),
                rank1Prize: parseInt(data.rank1Prize || 0)
            });
            await newT.save();
            return res.json({ success: true, message: "Tournament Published Successfully!" });
        }

        if (action === "UPDATE_ROOM") {
            await Tournament.updateOne({ id: data.tournamentId }, { $set: { roomId: data.roomId, roomPass: data.roomPass } });
            return res.json({ success: true, message: "Room Credentials Pushed!" });
        }

        if (action === "EXPORT_USERS_DATA") return res.json({ success: true, users: await User.find({}) });

        res.status(400).json({ success: false, message: "Invalid Action Requested" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- STATIC FILES & ROUTING ---

app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => console.log(`Server active on Port ${PORT}`));
