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

// Configuration Constants[cite: 9]
const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";
const ADMIN_EMAIL = "its.kds.dev@gmail.com";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwk1G8-N-XBpyq59ZRoMZ5S1CcPblaErbglJLxe7SG_0TFdQlZYoLETuOR_j1Gp08gr/exec";

// Email Transporter setup for direct Nodemailer fallback[cite: 9]
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

// Database Connection[cite: 9]
mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

// --- MONGOOSE SCHEMAS ---[cite: 9]

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
    profilePic: { type: String, default: "https://api.dicebear.com/7.x/bottts/svg?seed=Gamer1" },
    walletBalance: { type: Number, default: 0 },
    weeklyFreeMatchesPlayed: { type: Number, default: 0 },
    weeklyFreeWins: { type: Number, default: 0 },
    totalPaidMatchesPlayed: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    vipPassCount: { type: Number, default: 0 },
    referralCode: { type: String, required: true },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    isBanned: { type: Boolean, default: false }, // Player Ban/Block Flag
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

// Reset Weekly Limits Every Monday Midnight[cite: 9]
cron.schedule('0 0 * * 1', async () => {
    try { await User.updateMany({}, { $set: { weeklyFreeMatchesPlayed: 0, weeklyFreeWins: 0 } }); } catch (err) {}
});

function calculateAge(dobString) {
    const today = new Date();
    const birthDate = new Date(dobString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

// --- API ENDPOINTS ---

// PLAYER REGISTRATION[cite: 9]
app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referredBy } = req.body;

        if (!name || !email || !mobile || !dob || !gender || !password) {
            return res.status(400).json({ success: false, message: "All required fields must be filled!" });
        }

        if (calculateAge(dob) < 10) {
            return res.status(400).json({ success: false, message: "Registration failed: Minimum age requirement is 10 years!" });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanMobile = mobile.trim();

        const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { mobile: cleanMobile }] });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists with this Email or Mobile Number!" });
        }

        const referCode = "REF" + Math.floor(100000 + Math.random() * 900000);
        const newUser = new User({
            identifier: cleanEmail,
            email: cleanEmail,
            mobile: cleanMobile,
            name,
            dob,
            gender,
            password,
            referralCode: referCode,
            referredBy: (referredBy && referredBy.trim() !== "") ? referredBy.trim() : null
        });

        if (newUser.referredBy) {
            const referrer = await User.findOne({ referralCode: newUser.referredBy });
            if (referrer) {
                referrer.walletBalance += 10;
                referrer.referralCount += 1;
                await referrer.save();
                newUser.walletBalance += 5;
            }
        }

        await newUser.save();

        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: "REGISTRATION",
                    name,
                    email: cleanEmail,
                    mobile: cleanMobile,
                    dob,
                    gender,
                    referralCode: referCode
                })
            });
        } catch (scriptErr) {
            console.error("App Script Trigger Error:", scriptErr.message);
        }

        res.json({ success: true, message: "Registration Successful! Confirmation emails sent." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PLAYER LOGIN[cite: 9]
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) return res.status(400).json({ success: false, message: "Mobile/Email and Password are required!" });

        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }, { identifier: cleanInput }] });

        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Invalid Mobile/Email or Password!" });
        }

        if (user.isBanned) {
            return res.status(403).json({ success: false, message: "Your account has been banned by the Administrator!" });
        }

        const config = await getConfigs();
        res.json({ success: true, user, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// FORGOT PASSWORD[cite: 9]
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: "Provide Registered Email or Mobile Number!" });

        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }] });

        if (!user) return res.status(404).json({ success: false, message: "No account found with provided Email/Mobile!" });

        const token = crypto.randomBytes(32).toString('hex');
        user.resetToken = token;
        user.resetTokenExpires = Date.now() + 3600000;
        await user.save();

        const resetLink = `https://kds-esport.onrender.com/reset-password.html?token=${token}&email=${encodeURIComponent(user.email)}`;

        const mailOptions = {
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: user.email,
            subject: '🔑 Password Reset Link - KDS E-sport',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h3>Password Reset Request</h3>
                    <p>Hello ${user.name}, click the button below to reset your password:</p>
                    <a href="${resetLink}" style="background:#00ff88; color:#000; padding:10px 15px; text-decoration:none; font-weight:bold; border-radius:5px;">Reset Password</a>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to send reset link email." });
            res.json({ success: true, message: "Password reset link sent to player's registered Email ID!" });
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// EDIT PROFILE & AVATAR[cite: 9]
app.post('/api/player/update-profile', async (req, res) => {
    try {
        const { identifier, name, profilePic, mobile } = req.body;
        const user = await User.findOne({ identifier: identifier.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });

        if (name) user.name = name;
        if (profilePic) user.profilePic = profilePic;
        if (mobile) user.mobile = mobile;

        await user.save();
        res.json({ success: true, message: "Profile Updated Successfully!", user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ADD MONEY VIA UTR[cite: 9]
app.post('/api/player/add-money', async (req, res) => {
    try {
        const { identifier, amount, utr } = req.body;
        const amt = parseInt(amount);

        if (!utr || utr.length !== 12) return res.status(400).json({ success: false, message: "Enter valid 12-Digit UTR!" });
        if (await UsedUtr.findOne({ utr })) return res.status(400).json({ success: false, message: "This UTR is already used!" });

        const user = await User.findOne({ identifier: identifier.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });

        await UsedUtr.create({ utr, identifier: user.identifier });
        user.walletBalance += amt;
        await user.save();

        res.json({ success: true, message: `₹${amt} Added to Wallet Successfully!`, user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET TOURNAMENTS[cite: 9]
app.get('/api/tournaments', async (req, res) => {
    try {
        const tournaments = await Tournament.find({});
        const config = await getConfigs();
        res.json({ tournaments, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// BOOK MATCH[cite: 9]
app.post('/api/tournaments/book', async (req, res) => {
    try {
        const { tournamentId, identifier, username, gameId, utr, payViaWallet } = req.body;
        const tournament = await Tournament.findOne({ id: tournamentId });
        const user = await User.findOne({ identifier: identifier.toLowerCase() });

        if (!tournament || !user) return res.status(400).json({ success: false, message: "Invalid Request." });

        if (user.isBanned) return res.status(403).json({ success: false, message: "Banned players cannot book matches!" });

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

// SUPPORT TICKET[cite: 9]
app.post('/api/user/support-ticket', async (req, res) => {
    try {
        const { identifier, category, message, attachmentUrl } = req.body;
        const ticket = new SupportTicket({ ticketId: "TCK_" + Date.now(), identifier: identifier.toLowerCase(), category, message, attachmentUrl });
        await ticket.save();
        res.json({ success: true, message: "Ticket Submitted to Support Team!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ADMIN CONTROL API[cite: 9]
app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== ADMIN_SECRET) return res.status(401).json({ success: false, message: "Invalid Admin Secret Key!" });

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

        if (action === "UPDATE_ROOM") {
            await Tournament.updateOne({ id: data.tournamentId }, { $set: { roomId: data.roomId, roomPass: data.roomPass } });
            return res.json({ success: true, message: "Room Credentials Released!" });
        }

        // KICK PLAYER FROM MATCH (Admin Option)
        if (action === "KICK_PLAYER") {
            const { tournamentId, playerIdentifier } = data;
            await Tournament.updateOne(
                { id: tournamentId },
                { $pull: { registeredPlayers: { identifier: playerIdentifier.toLowerCase() } } }
            );
            return res.json({ success: true, message: "Player removed/kicked from the match successfully!" });
        }

        // BLOCK / BAN PLAYER (Admin Option)
        if (action === "TOGGLE_USER_BAN") {
            const { playerIdentifier, banStatus } = data;
            const user = await User.findOne({ $or: [{ email: playerIdentifier.toLowerCase() }, { mobile: playerIdentifier }] });
            if (!user) return res.status(404).json({ success: false, message: "Player not found!" });

            user.isBanned = banStatus;
            await user.save();
            return res.json({ success: true, message: `Player status updated. Banned: ${banStatus}` });
        }

        res.status(400).json({ success: false, message: "Invalid Action Code" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(process.env.PORT || 3000, () => console.log("Server running on port 3000"));
