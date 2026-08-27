const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const app = express();

app.use(express.json());
app.use(cors());

const ADMIN_SECRET = process.env.ADMIN_SECRET || "ADMIN1234";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kdsadmin:KdsAdmin1234@cluster0.mgvdmwr.mongodb.net/kds_esports?retryWrites=true&w=majority";

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
    loginType: { type: String, default: "PHONE" },
    name: { type: String, required: true },
    pin: { type: String, required: true },
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
const Withdrawal = mongoose.model('Withdrawal', new mongoose.Schema({ id: String, identifier: String, amount: Number, upiId: String, status: { type: String, default: "PENDING" }, timestamp: { type: Date, default: Date.now } }));

async function getConfigs() {
    let config = await SystemConfig.findOne();
    if (!config) config = await SystemConfig.create({});
    return config;
}

cron.schedule('0 0 * * 1', async () => {
    try { await User.updateMany({}, { $set: { weeklyFreeMatchesPlayed: 0, weeklyFreeWins: 0 } }); } catch (err) {}
});

// --- API ROUTES ---

app.post('/api/webhook/sms-listener', async (req, res) => {
    try {
        const { smsText } = req.body;
        if (!smsText) return res.status(400).json({ success: false, message: "No SMS content provided!" });

        const utrMatch = smsText.match(/\b\d{12}\b/);
        if (utrMatch) {
            const extractedUtr = utrMatch[0];
            const existingUtr = await SmsUtr.findOne({ utr: extractedUtr });
            if (!existingUtr) {
                await SmsUtr.create({ utr: extractedUtr });
            }
            return res.json({ success: true, message: "UTR Extracted and Logged!", utr: extractedUtr });
        }
        res.status(400).json({ success: false, message: "No 12-Digit UTR found in SMS." });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/user/auth', async (req, res) => {
    try {
        const { identifier, name, pin, referredBy } = req.body;
        if (!identifier || !pin || pin.length !== 4) {
            return res.status(400).json({ success: false, message: "Valid Phone/Email & 4-Digit PIN required!" });
        }

        const cleanId = identifier.trim().toLowerCase();
        let user = await User.findOne({ identifier: cleanId });

        if (!user) {
            const isEmail = cleanId.includes('@');
            const referCode = "REF" + Math.floor(100000 + Math.random() * 900000);
            user = new User({
                identifier: cleanId,
                loginType: isEmail ? "EMAIL" : "PHONE",
                name: name || (isEmail ? cleanId.split('@')[0] : "Player_" + cleanId.slice(-4)),
                pin,
                referralCode: referCode,
                referredBy: referredBy || null
            });

            if (referredBy && referredBy !== referCode) {
                const referrer = await User.findOne({ referralCode: referredBy });
                if (referrer) {
                    referrer.walletBalance += 10;
                    referrer.referralCount += 1;
                    await referrer.save();
                    user.walletBalance += 5;
                }
            }
            await user.save();
        } else {
            if (user.pin !== pin) return res.status(401).json({ success: false, message: "Incorrect Security PIN!" });
        }

        const config = await getConfigs();
        res.json({ success: true, user, configs: config });
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

        if (useVipPass) {
            if (!user.vipPassCount || user.vipPassCount <= 0) return res.status(400).json({ success: false, message: "No VIP Pass available!" });
            user.vipPassCount -= 1;
            user.totalPaidMatchesPlayed += 1;
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, mode: "VIP_PASS" });
            await user.save(); await tournament.save();
            return res.json({ success: true, message: "VIP Pass Applied Successfully!", user });
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

        const validSms = await SmsUtr.findOne({ utr });
        if (validSms) {
            await UsedUtr.create({ utr, identifier: user.identifier });
            user.totalPaidMatchesPlayed += 1;
            tournament.registeredPlayers.push({ identifier: user.identifier, username, gameId, utr, mode: "SMS_UTR" });
            await user.save(); await tournament.save();
            return res.json({ success: true, message: "UTR Verified & Slot Booked!", user });
        } else {
            return res.json({ success: false, message: "Payment Verification Pending. Please wait 10 seconds and retry." });
        }
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

app.get('/api/user/support-history/:identifier', async (req, res) => {
    try {
        const tickets = await SupportTicket.find({ identifier: req.params.identifier.toLowerCase() }).sort({ createdAt: -1 });
        res.json({ success: true, tickets });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/history/:identifier', async (req, res) => {
    try {
        const matches = await Tournament.find({ "registeredPlayers.identifier": req.params.identifier.toLowerCase() });
        res.json({ success: true, matches });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const top = await User.find({}).sort({ totalEarnings: -1 }).limit(10);
        res.json({ success: true, leaderboard: top });
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
        if (adminSecret !== ADMIN_SECRET) return res.status(401).json({ success: false, message: "Invalid Admin Secret Key!" });

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
                await User.updateMany({ identifier: { $in: identifiers } }, {
                    $push: { notifications: { title: "🎮 Room Credentials Released!", message: `Match ${t.id}: Room ID: ${data.roomId} | Pass: ${data.roomPass}` } }
                });
            }
            return res.json({ success: true, message: "Room Credentials Pushed to Joined Players!" });
        }

        res.status(400).json({ success: false, message: "Invalid Action Code" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
const path = require('path');

// Serve static directory
app.use(express.static(__dirname));

// Player App Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Complete Player Web Application.html'));
});

// Admin Panel Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'Complete Master Admin Dashboard.html'));
});
app.listen(process.env.PORT || 3000, () => console.log("Server Active on Port 3000"));
