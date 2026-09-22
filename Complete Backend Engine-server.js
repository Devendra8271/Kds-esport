const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";
const ADMIN_EMAIL = "its.kds.dev@gmail.com";
const BASE_URL = process.env.BASE_URL || "https://your-app-name.onrender.com"; // Apne live app ka URL daalein

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

// --- SCHEMAS & MODELS ---

const SystemConfigSchema = new mongoose.Schema({
    minMatchesRequired: { type: Number, default: 10 },
    minWinsRequired: { type: Number, default: 5 },
    minWithdrawalLimit: { type: Number, default: 50 },
    paymentGatewayActive: { type: Boolean, default: false },
    smsWebhookActive: { type: Boolean, default: true },
    customTerms: { type: String, default: "Standard Gaming Terms apply." },
    customPrivacy: { type: String, default: "Data is encrypted." },
    customAntiCheat: { type: String, default: "Hacking leads to permanent ban." },
    globalBroadcastMessage: { type: String, default: "" },
    appDownloadUrl: { type: String, default: "" }
});
const SystemConfig = mongoose.model('SystemConfig', SystemConfigSchema);

const UserSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    name: { type: String, required: true },
    dob: { type: String, required: true },
    gender: { type: String, default: "Male" },
    password: { type: String, required: true },
    walletBalance: { type: Number, default: 0 },
    weeklyFreeMatchesPlayed: { type: Number, default: 0 },
    weeklyFreeWins: { type: Number, default: 0 },
    totalPaidMatchesPlayed: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    vipPassCount: { type: Number, default: 0 },
    referralCode: { type: String, required: true },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    notifications: [{ title: String, message: String, timestamp: { type: Date, default: Date.now } }],
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

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
    streamPlatform: { type: String, default: "YOUTUBE" },
    streamUrl: { type: String, default: "" },
    registeredPlayers: [{
        identifier: String,
        username: String,
        gameId: String,
        mode: String,
        utr: String,
        joinedAt: { type: Date, default: Date.now }
    }]
});
const Tournament = mongoose.model('Tournament', TournamentSchema);

const SupportTicket = mongoose.model('SupportTicket', new mongoose.Schema({
    ticketId: { type: String, required: true, unique: true },
    identifier: { type: String, required: true },
    category: { type: String, required: true },
    message: { type: String, required: true },
    attachmentUrl: { type: String, default: "N/A" },
    status: { type: String, default: "PENDING" },
    createdAt: { type: Date, default: Date.now }
}));

const UsedUtr = mongoose.model('UsedUtr', new mongoose.Schema({ utr: { type: String, required: true, unique: true }, identifier: String, createdAt: { type: Date, default: Date.now } }));
const Withdrawal = mongoose.model('Withdrawal', new mongoose.Schema({ id: String, identifier: String, amount: Number, upiId: String, status: { type: String, default: "PENDING" }, timestamp: { type: Date, default: Date.now } }));

async function getConfigs() {
    let config = await SystemConfig.findOne();
    if (!config) config = await SystemConfig.create({});
    return config;
}

cron.schedule('0 0 * * 1', async () => {
    try { await User.updateMany({}, { $set: { weeklyFreeMatchesPlayed: 0, weeklyFreeWins: 0 } }); } catch (err) {}
});

function calculateAge(dobString) {
    const today = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// --- API ROUTES ---

// PLAYER REGISTRATION (10+ Age Check & Email Notification)
app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referredBy } = req.body;

        if (!name || !email || !mobile || !dob || !gender || !password) {
            return res.status(400).json({ success: false, message: "All fields are required!" });
        }

        const age = calculateAge(dob);
        if (age < 10) {
            return res.status(400).json({ success: false, message: "Registration failed: Minimum age requirement is 10 years!" });
        }

        const cleanEmail = email.trim().toLowerCase();
        const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { mobile }, { identifier: cleanEmail }] });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists with this Email or Mobile!" });
        }

        const referCode = "REF" + Math.floor(100000 + Math.random() * 900000);
        const newUser = new User({
            identifier: cleanEmail,
            email: cleanEmail,
            mobile,
            name,
            dob,
            gender,
            password,
            referralCode: referCode,
            referredBy: referredBy || null
        });

        if (referredBy) {
            const referrer = await User.findOne({ referralCode: referredBy });
            if (referrer) {
                referrer.walletBalance += 10;
                referrer.referralCount += 1;
                await referrer.save();
                newUser.walletBalance += 5;
            }
        }

        await newUser.save();

        const mailOptions = {
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: `${cleanEmail}, ${ADMIN_EMAIL}`,
            subject: '🎮 Welcome to KDS E-sport - Registration Successful!',
            html: `
                <h2>Registration Details</h2>
                <p><b>Name:</b> ${name}</p>
                <p><b>Email:</b> ${cleanEmail}</p>
                <p><b>Mobile:</b> ${mobile}</p>
                <p><b>Date of Birth:</b> ${dob}</p>
                <p><b>Gender:</b> ${gender}</p>
                <p><b>Referral Code:</b> ${referCode}</p>
                <br>
                <p>Thank you for joining KDS E-sport!</p>
            `
        };

        transporter.sendMail(mailOptions, (err) => {
            if (err) console.error("Email Error:", err);
        });

        res.json({ success: true, message: "Registration Successful! Check email for confirmation." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PLAYER LOGIN
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) return res.status(400).json({ success: false, message: "Identifier and Password required!" });

        const cleanId = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }] });

        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Invalid Identifier or Password!" });
        }

        const config = await getConfigs();
        res.json({ success: true, user, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// FORGOT PASSWORD (FORWARDS RESET LINK TO REGISTERED EMAIL EVEN IF MOBILE IS ENTERED)
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: "Provide Registered Email or Mobile!" });

        const cleanId = identifier.trim().toLowerCase();
        
        // Search user by email, mobile, or identifier
        const user = await User.findOne({ $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }] });

        if (!user) return res.status(404).json({ success: false, message: "Account not found!" });

        // Generate Forgot Password Reset Link
        const resetLink = `${BASE_URL}/#reset-password?id=${user._id}`;

        const mailOptions = {
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: user.email, // Always send to registered Email
            subject: '🔑 Password Reset Request - KDS E-sport',
            html: `
                <h3>Hello ${user.name},</h3>
                <p>You requested a password reset for your KDS E-sport account.</p>
                <p>Your current password is: <b>${user.password}</b></p>
                <p>Or click the link below to access your account:</p>
                <p><a href="${resetLink}" style="background:#00ff88; color:#000; padding:10px 15px; text-decoration:none; border-radius:5px; font-weight:bold;">Reset / Recover Password</a></p>
                <br>
                <p>If you did not request this, please ignore this email.</p>
            `
        };

        transporter.sendMail(mailOptions, (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to send recovery email." });
            res.json({ 
                success: true, 
                message: `Password reset link has been sent to your registered Email: (${user.email.replace(/(.{2})(.*)(?=@)/, "$1***")})` 
            });
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/tournaments', async (req, res) => {
    try {
        const tournaments = await Tournament.find({});
        const config = await getConfigs();
        res.json({ tournaments, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/tournaments/book', async (req, res) => {
    try {
        const { tournamentId, identifier, username, gameId, utr, payViaWallet, useVipPass } = req.body;
        const tournament = await Tournament.findOne({ id: tournamentId });
        const user = await User.findOne({ identifier: identifier.toLowerCase() });

        if (!tournament || !user) return res.status(400).json({ success: false, message: "Invalid Request." });
        if (tournament.registeredPlayers.find(p => p.identifier === user.identifier)) {
            return res.status(400).json({ success: false, message: "Already Joined this match!" });
        }
        if (tournament.registeredPlayers.length >= tournament.totalSlots) {
            return res.status(400).json({ success: false, message: "Match is Full!" });
        }

        if (parseInt(tournament.entryFee) === 0) {
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, mode: "FREE" });
            user.weeklyFreeMatchesPlayed += 1;
            await tournament.save(); await user.save();
            return res.json({ success: true, message: "Free Match Booked!", user });
        }

        if (payViaWallet) {
            if (user.walletBalance < tournament.entryFee) return res.status(400).json({ success: false, message: "Insufficient Wallet balance!" });
            user.walletBalance -= tournament.entryFee;
            user.totalPaidMatchesPlayed += 1;
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, mode: "WALLET" });
            await user.save(); await tournament.save();
            return res.json({ success: true, message: "Booked via Wallet Balance!", user });
        }

        if (!utr || utr.length !== 12) return res.status(400).json({ success: false, message: "Invalid 12-Digit UTR Number!" });
        if (await UsedUtr.findOne({ utr })) return res.status(400).json({ success: false, message: "This UTR is already used!" });

        await UsedUtr.create({ utr, identifier: user.identifier });
        user.totalPaidMatchesPlayed += 1;
        tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, utr, mode: "MANUAL_UTR" });
        await user.save(); await tournament.save();
        return res.json({ success: true, message: "Slot Booked Successfully!", user });

    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== "dev8271@") return res.status(401).json({ success: false, message: "Invalid Admin Secret Key!" });

        if (action === "ADD_TOURNAMENT") {
            const count = await Tournament.countDocuments();
            const newT = new Tournament({
                id: "T" + (count + 101), gameName: data.gameName, matchMode: data.matchMode || "SOLO",
                status: "UPCOMING", matchDate: data.matchDate, matchTime: data.matchTime, bannerUrl: data.bannerUrl,
                entryFee: parseInt(data.entryFee), totalSlots: parseInt(data.totalSlots || 100), upiId: data.upiId,
                perKillPrize: parseInt(data.perKillPrize || 0), rank1Prize: parseInt(data.rank1Prize || 0)
            });
            await newT.save();
            return res.json({ success: true, message: "Tournament Published Successfully!" });
        }

        res.status(400).json({ success: false, message: "Invalid Action Code" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log("Server Active on Port 3000"));
