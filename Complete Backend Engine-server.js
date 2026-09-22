const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();

app.use(express.json());
app.use(cors());

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";

// Nodemailer Transporter - Email Configuration with updated Password
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'Dev8271@' // Updated Password
    }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

// --- DATABASE SCHEMAS ---

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
    loginType: { type: String, default: "PHONE" },
    name: { type: String, required: true },
    email: { type: String },
    mobile: { type: String },
    dob: { type: String },
    gender: { type: String },
    password: { type: String },
    pin: { type: String, default: "1234" },
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
const SmsUtr = mongoose.model('SmsUtr', new mongoose.Schema({ utr: { type: String, required: true, unique: true }, createdAt: { type: Date, default: Date.now } }));

async function getConfigs() {
    let config = await SystemConfig.findOne();
    if (!config) config = await SystemConfig.create({});
    return config;
}

cron.schedule('0 0 * * 1', async () => {
    try { await User.updateMany({}, { $set: { weeklyFreeMatchesPlayed: 0, weeklyFreeWins: 0 } }); } catch (err) {}
});

// --- API ROUTES ---

// REGISTRATION API (With Referral System & Native DOB)
app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referralCode } = req.body;
        if (!name || !email || !mobile || !password) {
            return res.status(400).json({ success: false, message: "Required fields missing!" });
        }

        const cleanMobile = mobile.trim();
        const cleanEmail = email.trim().toLowerCase();

        let existingUser = await User.findOne({ $or: [{ identifier: cleanMobile }, { identifier: cleanEmail }, { mobile: cleanMobile }, { email: cleanEmail }] });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already registered with this Email/Mobile!" });
        }

        const selfReferCode = "REF" + Math.floor(100000 + Math.random() * 900000);
        const newUser = new User({
            identifier: cleanMobile,
            loginType: "PHONE",
            name,
            email: cleanEmail,
            mobile: cleanMobile,
            dob,
            gender,
            password,
            pin: "1234",
            referralCode: selfReferCode,
            referredBy: referralCode || null
        });

        if (referralCode) {
            const referrer = await User.findOne({ referralCode: referralCode.trim() });
            if (referrer) {
                referrer.walletBalance += 10;
                referrer.referralCount += 1;
                await referrer.save();
                newUser.walletBalance += 5;
            }
        }

        await newUser.save();
        res.json({ success: true, message: "Registration Successful! Please Login." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// LOGIN API
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Mobile/Email and Password required!" });
        }

        const cleanId = identifier.trim().toLowerCase();
        const user = await User.findOne({
            $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }]
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found! Please Register." });
        }

        if (user.password !== password) {
            return res.status(401).json({ success: false, message: "Incorrect Password!" });
        }

        const config = await getConfigs();
        res.json({ success: true, message: "Login Successful!", user, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// FORGOT PASSWORD VIA GMAIL (its.kds.dev@gmail.com)
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: "Enter Email or Mobile!" });

        const cleanId = identifier.trim().toLowerCase();
        const user = await User.findOne({
            $or: [{ identifier: cleanId }, { email: cleanId }, { mobile: cleanId }]
        });

        if (!user || !user.email) {
            return res.status(404).json({ success: false, message: "No registered account or email found!" });
        }

        const mailOptions = {
            from: '"KDS E-sport Hub" <its.kds.dev@gmail.com>',
            to: user.email,
            subject: 'KDS E-sport - Account Credentials Recovery',
            html: `
                <div style="font-family: Arial, sans-serif; background: #121212; color: #fff; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #00ff88;">KDS E-sport Gaming Hub</h2>
                    <p>Hello <b>${user.name}</b>,</p>
                    <p>Here are your requested login details:</p>
                    <div style="background: #1e1e1e; padding: 15px; border: 1px solid #00ff88; border-radius: 5px; margin: 10px 0;">
                        <p style="margin: 5px 0;"><b>Login ID:</b> ${user.identifier}</p>
                        <p style="margin: 5px 0;"><b>Password:</b> ${user.password}</p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: `Password details sent to ${user.email}!` });
    } catch (err) {
        console.error("Nodemailer Error:", err);
        res.status(500).json({ success: false, message: "Failed to send email. Check credentials or Gmail App Password setup." });
    }
});

// TOURNAMENTS
app.get('/api/tournaments', async (req, res) => {
    try {
        const tournaments = await Tournament.find({});
        const config = await getConfigs();
        res.json({ tournaments, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/tournaments/book', async (req, res) => {
    try {
        const { tournamentId, identifier, username, gameId, utr, payViaWallet } = req.body;
        const tournament = await Tournament.findOne({ id: tournamentId });
        const user = await User.findOne({ identifier: identifier ? identifier.toLowerCase() : '' });

        if (!tournament || !user) return res.status(400).json({ success: false, message: "Invalid Request." });
        if (tournament.registeredPlayers.find(p => p.identifier === user.identifier)) {
            return res.status(400).json({ success: false, message: "Already Joined this match!" });
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

        if (!utr || utr.length !== 12) return res.status(400).json({ success: false, message: "Invalid 12-Digit UTR!" });
        if (await UsedUtr.findOne({ utr })) return res.status(400).json({ success: false, message: "UTR already used!" });

        const validSms = await SmsUtr.findOne({ utr });
        if (validSms) {
            await UsedUtr.create({ utr, identifier: user.identifier });
            user.totalPaidMatchesPlayed += 1;
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, utr, mode: "SMS_UTR" });
            await user.save(); await tournament.save();
            return res.json({ success: true, message: "Payment Verified & Slot Booked!", user });
        } else {
            return res.json({ success: false, message: "Payment Verification Pending. Retry after 10 seconds." });
        }
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ADMIN API CONTROL
app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== ADMIN_SECRET) return res.status(401).json({ success: false, message: "Invalid Admin Key!" });

        if (action === "ADD_TOURNAMENT") {
            const count = await Tournament.countDocuments();
            const newT = new Tournament({
                id: "T" + (count + 101), gameName: data.gameName, matchMode: data.matchMode || "SOLO",
                status: "UPCOMING", matchDate: data.matchDate, matchTime: data.matchTime, bannerUrl: data.bannerUrl,
                entryFee: parseInt(data.entryFee), totalSlots: parseInt(data.totalSlots || 100), upiId: data.upiId,
                perKillPrize: parseInt(data.perKillPrize || 0), rank1Prize: parseInt(data.rank1Prize || 0)
            });
            await newT.save();
            return res.json({ success: true, message: "Tournament Published!" });
        }

        if (action === "UPDATE_ROOM") {
            await Tournament.updateOne({ id: data.tournamentId }, { $set: { roomId: data.roomId, roomPass: data.roomPass } });
            return res.json({ success: true, message: "Room Credentials Updated!" });
        }

        if (action === "EXPORT_USERS_DATA") return res.json({ success: true, users: await User.find({}) });

        res.status(400).json({ success: false, message: "Invalid Action" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'players.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log("Server running on Port 3000"));
