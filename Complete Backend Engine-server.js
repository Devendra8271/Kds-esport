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

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev8271@";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";
const ADMIN_EMAIL = "its.kds.dev@gmail.com";

// Email Transporter Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'its.kds.dev@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password' // Use Gmail App Password
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
    profilePic: { type: String, default: "https://via.placeholder.com/100" },
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
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

// --- API ROUTES ---

// PLAYER REGISTRATION
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

        // Send Email Notification to Player & Admin
        const mailOptions = {
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: `${cleanEmail}, ${ADMIN_EMAIL}`,
            subject: '🎮 Welcome to KDS E-sport - Registration Successful!',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f4f4;">
                    <div style="background: #fff; padding: 20px; border-radius: 8px;">
                        <h2 style="color: #00ff88;">Thank You for Registering with KDS E-sport!</h2>
                        <p>Hello <b>${name}</b>, your account has been successfully created.</p>
                        <h3>Your Registration Details:</h3>
                        <ul>
                            <li><b>Name:</b> ${name}</li>
                            <li><b>Email:</b> ${cleanEmail}</li>
                            <li><b>Mobile:</b> ${cleanMobile}</li>
                            <li><b>Date of Birth:</b> ${dob}</li>
                            <li><b>Gender:</b> ${gender}</li>
                            <li><b>Referral Code:</b> ${referCode}</li>
                        </ul>
                        <p>Enjoy playing tournaments and earning rewards!</p>
                    </div>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (err) => { if (err) console.error("Email Sending Error:", err); });

        res.json({ success: true, message: "Registration Successful! Confirmation email sent." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PLAYER LOGIN (via Email OR Mobile)
app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) return res.status(400).json({ success: false, message: "Mobile/Email and Password are required!" });

        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }, { identifier: cleanInput }] });

        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: "Invalid Mobile/Email or Password!" });
        }

        const config = await getConfigs();
        res.json({ success: true, user, configs: config });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// FORGOT PASSWORD - SENDS RESET LINK TO EMAIL
app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: "Provide Registered Email or Mobile Number!" });

        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: cleanInput }] });

        if (!user) return res.status(404).json({ success: false, message: "No account found with provided Email/Mobile!" });

        const token = crypto.randomBytes(32).toString('hex');
        user.resetToken = token;
        user.resetTokenExpires = Date.now() + 3600000; // 1 Hour Validity
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
                    <p style="margin-top:15px; color:#777;">Link expires in 1 hour.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to send reset link email." });
            res.json({ success: true, message: "Password reset link has been sent to player's registered Email ID!" });
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// RESET PASSWORD VIA TOKEN LINK
app.post('/api/player/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const user = await User.findOne({ resetToken: token, resetTokenExpires: { $gt: Date.now() } });

        if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset token!" });

        user.password = newPassword;
        user.resetToken = null;
        user.resetTokenExpires = null;
        await user.save();

        res.json({ success: true, message: "Password reset successful! You can now login with your new password." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// EDIT PROFILE & ADD WALLET FUNDS
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

app.post('/api/user/support-ticket', async (req, res) => {
    try {
        const { identifier, category, message, attachmentUrl } = req.body;
        const ticket = new SupportTicket({ ticketId: "TCK_" + Date.now(), identifier: identifier.toLowerCase(), category, message, attachmentUrl });
        await ticket.save();
        res.json({ success: true, message: "Ticket Submitted to Support Team!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/history/:identifier', async (req, res) => {
    try {
        const matches = await Tournament.find({ "registeredPlayers.identifier": req.params.identifier.toLowerCase() });
        res.json({ success: true, matches });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/user/withdraw', async (req, res) => {
    try {
        const { identifier, amount, upiId } = req.body;
        const user = await User.findOne({ identifier: identifier.toLowerCase() });
        const config = await getConfigs();
        const amt = parseInt(amount || 0);

        if (amt < config.minWithdrawalLimit) return res.status(400).json({ success: false, message: `Minimum Withdrawal amount is ₹${config.minWithdrawalLimit}` });
        if (user.walletBalance < amt) return res.status(400).json({ success: false, message: "Insufficient Wallet Balance!" });

        user.walletBalance -= amt;
        await user.save();
        await Withdrawal.create({ id: "WD_" + Date.now(), identifier: user.identifier, amount: amt, upiId });
        res.json({ success: true, message: "Withdrawal Request Submitted!", newBalance: user.walletBalance });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// --- ADMIN CONTROL APIs ---

app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== "dev8271@") return res.status(401).json({ success: false, message: "Invalid Admin Secret Key!" });

        let config = await getConfigs();

        if (action === "UPDATE_APP_LINK") {
            config.appDownloadUrl = data.appDownloadUrl;
            await config.save();
            return res.json({ success: true, message: "App Download Link Successfully Updated!" });
        }

        if (action === "AUTO_SETTLE_MATCH") {
            const { tournamentId, results } = data;
            const tournament = await Tournament.findOne({ id: tournamentId });
            if (!tournament) return res.status(404).json({ success: false, message: "Tournament Not Found" });

            for (let r of results) {
                const player = await User.findOne({ identifier: r.identifier.toLowerCase() });
                if (player) {
                    let totalPrize = (parseInt(r.kills || 0) * tournament.perKillPrize);
                    if (parseInt(r.rank) === 1) {
                        totalPrize += tournament.rank1Prize;
                        player.weeklyFreeWins += 1;
                    }
                    player.walletBalance += totalPrize;
                    player.totalEarnings += totalPrize;
                    player.notifications.push({
                        title: "🏆 Match Reward Credited!",
                        message: `Match ${tournament.id}: ${r.kills} Kills (Rank #${r.rank}). ₹${totalPrize} added to your wallet.`
                    });
                    await player.save();
                }
            }
            tournament.status = "COMPLETED";
            await tournament.save();
            return res.json({ success: true, message: "Match Settled & Rewards Distributed Automatically!" });
        }

        if (action === "PUSH_GLOBAL_NOTIFICATION") {
            const { title, message } = data;
            await User.updateMany({}, { $push: { notifications: { title, message, timestamp: new Date() } } });
            return res.json({ success: true, message: "Push Broadcast Sent to All Players!" });
        }

        if (action === "EXPORT_USERS_DATA") return res.json({ success: true, users: await User.find({}) });

        if (action === "EXPORT_BOOKINGS_DATA") {
            const tournaments = await Tournament.find({});
            let bookings = [];
            tournaments.forEach(t => {
                t.registeredPlayers.forEach(p => {
                    bookings.push({ tournamentId: t.id, gameName: t.gameName, identifier: p.identifier, inGameName: p.username, gameUid: p.gameId, paymentMode: p.mode, utr: p.utr || "N/A" });
                });
            });
            return res.json({ success: true, bookings });
        }

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
            const t = await Tournament.findOne({ id: data.tournamentId });
            if (t) {
                const identifiers = t.registeredPlayers.map(p => p.identifier);
                await User.updateMany({ identifier: { $in: identifiers } }, {$push: { notifications: { title: "🎮 Room Credentials Released!", message: `Match ${t.id}: Room ID: ${data.roomId} | Pass: ${data.roomPass}` } }
                });
            }
            return res.json({ success: true, message: "Room Credentials Pushed to Joined Players!" });
        }

        res.status(400).json({ success: false, message: "Invalid Action Code" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log("Server Active on Port 3000"));
