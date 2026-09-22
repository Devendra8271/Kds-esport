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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'its.kds.dev@gmail.com', pass: 'ecfz ymiu gcoj lsis' }
});

mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully!"))
  .catch(err => console.error("Database Connection Error:", err));

const SystemConfigSchema = new mongoose.Schema({
    minWithdrawalLimit: { type: Number, default: 50 },
    appDownloadUrl: { type: String, default: "" }
});
const SystemConfig = mongoose.model('SystemConfig', SystemConfigSchema);

const UserSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    email: { type: String, default: "" },
    mobile: { type: String, default: "" },
    name: { type: String, default: "Player" },
    dob: { type: String, default: "2000-01-01" },
    gender: { type: String, default: "Male" },
    password: { type: String, default: "" },
    profilePic: { type: String, default: "https://api.dicebear.com/7.x/bottts/svg?seed=Gamer1" },
    walletBalance: { type: Number, default: 0 },
    referralCode: { type: String, default: () => "REF" + Math.floor(100000 + Math.random() * 900000) },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    isBanned: { type: Boolean, default: false },
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
    registeredPlayers: [{ identifier: String, username: String, gameId: String, utr: String }]
});
const Tournament = mongoose.model('Tournament', TournamentSchema);
const UsedUtr = mongoose.model('UsedUtr', new mongoose.Schema({ utr: String, identifier: String }));

async function getConfigs() {
    let config = await SystemConfig.findOne();
    if (!config) config = await SystemConfig.create({});
    return config;
}

app.post('/api/player/register', async (req, res) => {
    try {
        const { name, email, mobile, dob, gender, password, referredBy } = req.body;
        const cleanEmail = email.trim().toLowerCase();
        if (await User.findOne({ $or: [{ email: cleanEmail }, { mobile: mobile.trim() }] })) {
            return res.status(400).json({ success: false, message: "User already exists with this Email or Mobile!" });
        }
        const newUser = new User({
            identifier: cleanEmail, email: cleanEmail, mobile: mobile.trim(), name, dob, gender, password,
            referredBy: (referredBy && referredBy.trim() !== "") ? referredBy.trim() : null
        });
        await newUser.save();
        res.json({ success: true, message: "Registration Successful!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/player/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: identifier.trim() }, { identifier: cleanInput }] });
        if (!user || user.password !== password) return res.status(401).json({ success: false, message: "Invalid Mobile/Email or Password!" });
        if (user.isBanned) return res.status(403).json({ success: false, message: "Your account has been banned!" });
        res.json({ success: true, user, configs: await getConfigs() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/player/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        const cleanInput = identifier.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ email: cleanInput }, { mobile: identifier.trim() }, { identifier: cleanInput }] });
        if (!user) return res.status(404).json({ success: false, message: "User not found with this Email/Mobile!" });

        const token = crypto.randomBytes(32).toString('hex');
        user.resetToken = token;
        user.resetTokenExpires = Date.now() + 3600000;
        await user.save({ validateBeforeSave: false });

        // Reset link pointing to player page itself
        const resetLink = `https://kds-esport.onrender.com/kds%20e-%20sport%20player.html?token=${token}&email=${encodeURIComponent(user.email)}`;

        transporter.sendMail({
            from: 'KDS E-sports <its.kds.dev@gmail.com>',
            to: user.email,
            subject: '🔑 Password Reset Link',
            html: `<div style="background:#121212; color:#fff; padding:20px;"><h3>Password Reset</h3><p>Click below to reset your password:</p><a href="${resetLink}" style="background:#00ff88; color:#000; padding:10px 15px; text-decoration:none; font-weight:bold;">Reset Password</a></div>`
        }, (err) => {
            if (err) return res.status(500).json({ success: false, message: "Failed to send email." });
            res.json({ success: true, message: "Password reset link sent to your email!" });
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/player/reset-password-confirm', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;
        const user = await User.findOne({ email: email.toLowerCase(), resetToken: token, resetTokenExpires: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ success: false, message: "Invalid or expired token!" });

        user.password = newPassword;
        user.resetToken = null;
        user.resetTokenExpires = null;
        await user.save();
        res.json({ success: true, message: "Password updated successfully!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/player/update-profile', async (req, res) => {
    try {
        const { identifier, name, profilePic, mobile } = req.body;
        const user = await User.findOne({ identifier: identifier.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });
        if (name) user.name = name;
        if (profilePic) user.profilePic = profilePic;
        if (mobile) user.mobile = mobile;
        await user.save();
        res.json({ success: true, message: "Profile Updated!", user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/player/add-money', async (req, res) => {
    try {
        const { identifier, amount, utr } = req.body;
        if (!utr || utr.length !== 12) return res.status(400).json({ success: false, message: "Invalid 12-Digit UTR!" });
        if (await UsedUtr.findOne({ utr })) return res.status(400).json({ success: false, message: "UTR already used!" });

        const user = await User.findOne({ identifier: identifier.toLowerCase() });
        await UsedUtr.create({ utr, identifier: user.identifier });
        user.walletBalance += parseInt(amount);
        await user.save();
        res.json({ success: true, message: "Funds Added Successfully!", user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/tournaments', async (req, res) => {
    res.json({ tournaments: await Tournament.find({}), configs: await getConfigs() });
});

app.post('/api/tournaments/book', async (req, res) => {
    try {
        const { tournamentId, identifier, username, gameId, utr, payViaWallet } = req.body;
        const tournament = await Tournament.findOne({ id: tournamentId });
        const user = await User.findOne({ identifier: identifier.toLowerCase() });

        if (payViaWallet) {
            if (user.walletBalance < tournament.entryFee) return res.status(400).json({ success: false, message: "Low wallet balance!" });
            user.walletBalance -= tournament.entryFee;
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, utr: "WALLET" });
            await user.save(); await tournament.save();
            return res.json({ success: true, message: "Booked via Wallet!", user });
        }

        if (!utr || utr.length !== 12) return res.status(400).json({ success: false, message: "Invalid UTR!" });
        if (await UsedUtr.findOne({ utr })) return res.status(400).json({ success: false, message: "UTR already used!" });
        await UsedUtr.create({ utr, identifier: user.identifier });
        tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, utr });
        await user.save(); await tournament.save();
        res.json({ success: true, message: "Booked Successfully!", user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/system-control', async (req, res) => {
    try {
        const { adminSecret, action, data } = req.body;
        if (adminSecret !== ADMIN_SECRET) return res.status(401).json({ success: false, message: "Invalid Secret Key!" });

        if (action === "ADD_TOURNAMENT") {
            const count = await Tournament.countDocuments();
            await new Tournament({
                id: "T" + (count + 101), gameName: data.gameName, matchMode: data.matchMode || "SOLO",
                matchDate: data.matchDate, matchTime: data.matchTime, bannerUrl: data.bannerUrl,
                entryFee: parseInt(data.entryFee), upiId: data.upiId,
                perKillPrize: parseInt(data.perKillPrize || 0), rank1Prize: parseInt(data.rank1Prize || 0)
            }).save();
            return res.json({ success: true, message: "Tournament Added!" });
        }
        if (action === "UPDATE_ROOM") {
            await Tournament.updateOne({ id: data.tournamentId }, { $set: { roomId: data.roomId, roomPass: data.roomPass } });
            return res.json({ success: true, message: "Room Updated!" });
        }
        if (action === "TOGGLE_USER_BAN") {
            await User.updateOne({ $or: [{ email: data.playerIdentifier.toLowerCase() }, { mobile: data.playerIdentifier }] }, {$set: { isBanned: data.banStatus } });
            return res.json({ success: true, message: "User status updated!" });
        }
        if (action === "KICK_PLAYER") {
            await Tournament.updateOne({ id: data.tournamentId }, { $pull: { registeredPlayers: { identifier: data.playerIdentifier.toLowerCase() } } });
            return res.json({ success: true, message: "Player removed from tournament!" });
        }
        res.status(400).json({ success: false, message: "Invalid Action" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Server running on port 3000"));
