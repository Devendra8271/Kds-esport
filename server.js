const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "its.kds.dev@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME";
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxdINJivtOJMpgz95PO4eqWIIifN_-FGec-4pDn9qh23mgdSAasxeWwtctgVkJ1UWhF3g/exec";
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const MIN_WITHDRAWAL = Number(process.env.MIN_WITHDRAWAL || 50);
const ROOM_RELEASE_MINUTES = Number(process.env.ROOM_RELEASE_MINUTES || 15);
const PORTAL_NAME = "KDS E-sports";

app.use(express.json({limit:"12mb"}));
app.use(express.urlencoded({extended:true, limit:"12mb"}));
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, "data.json");
const emptyDB = () => ({
  players: [], tournaments: [], deposits: [], withdrawals: [], disputes: [],
  proofs: [], notifications: [], audit: [],
  settings: {
    upiId: "", qrUrl: "", loyaltyFreeMatches: 10, loyaltyWins: 5,
    minWithdrawal: MIN_WITHDRAWAL, roomReleaseMinutes: ROOM_RELEASE_MINUTES,
    maintenance: false
  }
});
let db = emptyDB();
try {
  if (fs.existsSync(DB_FILE)) db = Object.assign(emptyDB(), JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
} catch (e) { console.error("DB load failed:", e.message); }

function save(){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function id(prefix){ return prefix + "_" + crypto.randomBytes(8).toString("hex"); }
function hash(v){ return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function now(){ return new Date().toISOString(); }
function safe(v){ return String(v ?? "").trim(); }
function ageFromDob(dob){
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return -1;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
}
function weekKey(){
  const d = new Date(); d.setHours(0,0,0,0);
  const day = (d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return d.toISOString().slice(0,10);
}
function publicPlayer(p){
  const {passwordHash, resetToken, resetExpires, ...safePlayer} = p;
  return safePlayer;
}
function findPlayer(identifier){
  const x = safe(identifier).toLowerCase();
  return db.players.find(p => p.email.toLowerCase() === x || p.mobile === safe(identifier));
}
function requirePlayer(req,res,next){
  const token = req.headers["x-player-token"];
  const s = db.sessions?.find(x => x.token === token && x.expiresAt > Date.now());
  if(!s) return res.status(401).json({success:false,error:"Player session expired. Please login again."});
  const p = db.players.find(x => x.id === s.playerId);
  if(!p || p.isBanned) return res.status(403).json({success:false,error:"Account unavailable."});
  req.player = p; next();
}
function requireAdmin(req,res,next){
  const token = req.headers["x-admin-token"];
  if(!token || token !== process.env.ADMIN_TOKEN) return res.status(403).json({success:false,error:"Admin authentication required."});
  next();
}
async function sync(payload){
  try {
    await fetch(APPS_SCRIPT_URL, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...payload, serverTime:now()})
    });
  } catch(e) { console.error("Apps Script sync:", e.message); }
}
function audit(action, actor, details={}){
  db.audit.push({id:id("aud"), action, actor, details, createdAt:now()});
  if(db.audit.length > 5000) db.audit = db.audit.slice(-5000);
  save();
  sync({type:"EVENT_LOG", action, actor, details}).catch(()=>{});
}
function notify(playerId, title, message){
  db.notifications.push({id:id("ntf"), playerId, title, message, read:false, createdAt:now()});
  save();
}
function ensureWeekly(p){
  const wk=weekKey();
  if(!p.weekly || p.weekly.weekKey!==wk) p.weekly={freeMatches:0,wins:0,passGrantedFor:null,weekKey:wk};
}
function roomVisible(t){
  if(!t.roomId || !t.roomReleasedAt) return false;
  const mins=(Date.now()-new Date(t.roomReleasedAt).getTime())/60000;
  return mins >= 0 && mins <= Number(t.roomReleaseMinutes || db.settings.roomReleaseMinutes || 15);
}
function publicTournament(t, player){
  const copy = JSON.parse(JSON.stringify(t));
  if(!roomVisible(t) && !(player && player.isAdmin)) {
    delete copy.roomId; delete copy.roomPass;
  }
  copy.roomVisible = roomVisible(t);
  copy.playerJoined = !!player && t.players.includes(player.id);
  return copy;
}

if(!db.sessions) db.sessions=[];

app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"player.html")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/api/health",(req,res)=>res.json({success:true,service:PORTAL_NAME,time:now()}));

app.post("/api/register", async (req,res)=>{
  try{
    const {name,email,mobile,dob,gender,password,referredBy=""}=req.body;
    if(!safe(name)||!safe(email)||!safe(mobile)||!safe(dob)||!safe(password)) throw Error("Name, email, mobile, DOB and password are required.");
    if(ageFromDob(dob)<10) throw Error("Minimum age is 10 years.");
    if(password.length<8) throw Error("Password must be at least 8 characters.");
    if(db.players.some(p=>p.email.toLowerCase()===email.toLowerCase())) throw Error("Email already registered.");
    if(db.players.some(p=>p.mobile===mobile)) throw Error("Mobile already registered.");
    const player={
      id:id("pl"), name:safe(name), email:safe(email), mobile:safe(mobile), dob, gender:safe(gender),
      passwordHash:hash(password), referralCode:("KDS"+crypto.randomBytes(4).toString("hex")).toUpperCase(),
      referredBy:safe(referredBy), isBanned:false, wallet:0, heldBalance:0, vipPasses:0,
      avatarUrl:"/default-avatar.svg", weekly:{freeMatches:0,wins:0,passGrantedFor:null,weekKey:weekKey()},
      createdAt:now(), lastLogin:null
    };
    db.players.push(player); save();
    await sync({type:"REGISTRATION",name:player.name,email:player.email,mobile:player.mobile,dob:player.dob,gender:player.gender,referralCode:player.referralCode,referredBy:player.referredBy});
    res.json({success:true,player:publicPlayer(player),message:"Registration successful. Welcome email sent."});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/login",(req,res)=>{
  try{
    const p=findPlayer(req.body.identifier);
    if(!p || p.passwordHash!==hash(req.body.password)) throw Error("Invalid email/mobile or password.");
    if(p.isBanned) throw Error("Account is banned.");
    const token=crypto.randomBytes(32).toString("hex");
    db.sessions=db.sessions.filter(s=>s.playerId!==p.id && s.expiresAt>Date.now());
    db.sessions.push({token,playerId:p.id,expiresAt:Date.now()+7*24*60*60*1000});
    p.lastLogin=now(); save();
    res.json({success:true,token,player:publicPlayer(p)});
  }catch(e){res.status(401).json({success:false,error:e.message});}
});

app.post("/api/logout",requirePlayer,(req,res)=>{
  const token=req.headers["x-player-token"]; db.sessions=db.sessions.filter(s=>s.token!==token); save();
  res.json({success:true});
});

app.get("/api/me",requirePlayer,(req,res)=>res.json({success:true,player:publicPlayer(req.player)}));

app.put("/api/profile",requirePlayer,(req,res)=>{
  try{
    const p=req.player, {name,gender,avatarUrl}=req.body;
    if(name!==undefined && (safe(name).length<2 || safe(name).length>60)) throw Error("Name must be 2-60 characters.");
    if(name!==undefined) p.name=safe(name);
    if(gender!==undefined) p.gender=safe(gender).slice(0,30);
    if(avatarUrl!==undefined){
      const av=safe(avatarUrl);
      if(av.length>1400000) throw Error("Avatar photo is too large.");
      if(av && !/^(https?:\/\/|data:image\/(jpeg|png|webp);base64,|\/default-avatar\.svg$)/i.test(av)) throw Error("Invalid avatar image.");
      p.avatarUrl=av || "/default-avatar.svg";
    }
    p.updatedAt=now(); save(); res.json({success:true,player:publicPlayer(p)});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/forgot-password",async(req,res)=>{
  try{
    const p=findPlayer(req.body.identifier);
    if(!p || !p.email) throw Error("Registered email account not found.");
    const token=crypto.randomBytes(32).toString("hex");
    p.resetToken=token; p.resetExpires=Date.now()+15*60*1000; save();
    const base=PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const resetLink=`${base}/?reset=${encodeURIComponent(token)}`;
    await sync({type:"FORGOT_PASSWORD",email:p.email,name:p.name,resetLink,expiresMinutes:15});
    res.json({success:true,message:"Password reset link sent to registered email."});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/reset-password",(req,res)=>{
  try{
    const {token,newPassword}=req.body;
    if(!token || !newPassword || String(newPassword).length<8) throw Error("Valid token and 8+ character password required.");
    const p=db.players.find(x=>x.resetToken===token && x.resetExpires>Date.now());
    if(!p) throw Error("Reset link expired or invalid.");
    p.passwordHash=hash(newPassword); delete p.resetToken; delete p.resetExpires; save();
    res.json({success:true,message:"Password updated. You can login now."});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/admin/login",(req,res)=>{
  if(safe(req.body.email)===ADMIN_EMAIL && safe(req.body.password)===ADMIN_PASSWORD){
    const token=process.env.ADMIN_TOKEN;
    if(!token) return res.status(500).json({success:false,error:"ADMIN_TOKEN is not configured."});
    res.json({success:true,token});
  } else res.status(401).json({success:false,error:"Invalid admin credentials."});
});

app.post("/api/admin/forgot-password",async(req,res)=>{
  if(safe(req.body.email)!==ADMIN_EMAIL) return res.status(400).json({success:false,error:"Admin email not recognized."});
  const resetLink=PUBLIC_URL ? `${PUBLIC_URL}/admin?adminReset=1` : `${req.protocol}://${req.get("host")}/admin?adminReset=1`;
  await sync({type:"ADMIN_FORGOT_PASSWORD",email:ADMIN_EMAIL,resetLink});
  res.json({success:true,message:"Admin recovery email sent."});
});

app.get("/api/payment-details",(req,res)=>res.json({success:true,...db.settings}));

app.post("/api/deposit",requirePlayer,(req,res)=>{
  try{
    const amount=Number(req.body.amount), utr=safe(req.body.utr);
    if(!Number.isFinite(amount)||amount<=0) throw Error("Invalid amount.");
    if(!/^\d{12}$/.test(utr)) throw Error("UTR must be exactly 12 numeric digits.");
    if(db.deposits.some(d=>d.utr===utr)) throw Error("Duplicate UTR blocked.");
    const d={id:id("dep"),playerId:req.player.id,identifier:req.player.email,amount,utr,status:"PENDING",createdAt:now()};
    db.deposits.push(d); save();
    sync({type:"DEPOSIT_REQUEST",...d});
    res.json({success:true,request:d});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/withdraw",requirePlayer,(req,res)=>{
  try{
    const amount=Number(req.body.amount), upiId=safe(req.body.upiId);
    const p=req.player;
    if(!Number.isFinite(amount)||amount<Number(db.settings.minWithdrawal||MIN_WITHDRAWAL)) throw Error(`Minimum withdrawal is ₹${db.settings.minWithdrawal||MIN_WITHDRAWAL}.`);
    if(amount>p.wallet) throw Error("Insufficient wallet balance.");
    if(!upiId) throw Error("UPI ID is required.");
    p.wallet-=amount; p.heldBalance=(p.heldBalance||0)+amount;
    const w={id:id("wd"),playerId:p.id,amount,upiId,status:"PENDING",createdAt:now()};
    db.withdrawals.push(w); save(); sync({type:"WITHDRAWAL_REQUEST",...w});
    res.json({success:true,request:w,player:publicPlayer(p)});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.get("/api/tournaments",requirePlayer,(req,res)=>{
  let list=db.tournaments;
  if(req.query.gameCategory) list=list.filter(t=>t.gameCategory===req.query.gameCategory);
  if(req.query.gameMode) list=list.filter(t=>t.gameMode===req.query.gameMode);
  res.json({success:true,tournaments:list.map(t=>publicTournament(t,req.player))});
});

app.post("/api/book",requirePlayer,(req,res)=>{
  try{
    const t=db.tournaments.find(x=>x.id===req.body.tournamentId), p=req.player, mode=safe(req.body.paymentMode||"WALLET").toUpperCase();
    if(!t) throw Error("Tournament not found.");
    if(t.status!=="OPEN") throw Error("Booking is closed.");
    if(t.players.includes(p.id)) throw Error("Duplicate player entry blocked.");
    if(t.maxPlayers && t.players.length>=t.maxPlayers) throw Error("Match is full.");
    if(mode==="FREE"){
      if(Number(t.entryFee)!==0) throw Error("This is not a free match.");
      p.weekly && ensureWeekly(p); p.weekly.freeMatches++;
    } else if(mode==="VIP"){
      ensureWeekly(p);
      if(Number(t.entryFee)<=0) throw Error("VIP pass is only for paid matches.");
      const lowest=db.tournaments.filter(x=>x.status==="OPEN" && Number(x.entryFee)>0).map(x=>Number(x.entryFee)).sort((a,b)=>a-b)[0];
      if(lowest!==undefined && Number(t.entryFee)!==lowest) throw Error("VIP pass can only be used on the lowest-entry paid match.");
      if(p.vipPasses<1) throw Error("No VIP pass available.");
      p.vipPasses--;
    } else if(mode==="WALLET"){
      if(p.wallet<Number(t.entryFee)) throw Error("Insufficient wallet balance.");
      p.wallet-=Number(t.entryFee);
    } else throw Error("Use wallet, VIP or free entry. Manual payment must be deposited and approved first.");
    t.players.push(p.id); save();
    res.json({success:true,tournament:publicTournament(t,p),player:publicPlayer(p)});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});

app.post("/api/loyalty/evaluate",requirePlayer,(req,res)=>{
  const p=req.player; ensureWeekly(p);
  let granted=false;
  if(p.weekly.freeMatches>=Number(db.settings.loyaltyFreeMatches) && p.weekly.wins>=Number(db.settings.loyaltyWins) && p.weekly.passGrantedFor!==p.weekly.weekKey){
    p.vipPasses++; p.weekly.passGrantedFor=p.weekly.weekKey; granted=true;
  }
  save(); res.json({success:true,weekly:p.weekly,vipPasses:p.vipPasses,granted});
});

app.get("/api/notifications",requirePlayer,(req,res)=>{
  res.json({success:true,notifications:db.notifications.filter(n=>n.playerId===req.player.id).slice(-50).reverse()});
});
app.post("/api/notifications/read",requirePlayer,(req,res)=>{
  db.notifications.filter(n=>n.playerId===req.player.id).forEach(n=>n.read=true); save(); res.json({success:true});
});

app.post("/api/proof",requirePlayer,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId);
  if(!t || !t.players.includes(req.player.id)) return res.status(400).json({success:false,error:"You are not registered in this match."});
  const proof={id:id("proof"),playerId:req.player.id,tournamentId:t.id,screenshotUrl:safe(req.body.screenshotUrl),killsClaimed:Number(req.body.killsClaimed||0),status:"PENDING",createdAt:now()};
  db.proofs.push(proof); save(); sync({type:"MATCH_PROOF",...proof}); res.json({success:true,proof});
});

app.post("/api/spectate",requirePlayer,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId);
  if(!t || !t.streamUrl) return res.status(404).json({success:false,error:"Live stream is not available."});
  res.json({success:true,streamUrl:t.streamUrl,redirectAfterSeconds:3,message:"You Were Eliminated"});
});

/* -------------------- ADMIN -------------------- */
app.get("/api/admin/data",requireAdmin,(req,res)=>{
  res.json({success:true,players:db.players.map(publicPlayer),tournaments:db.tournaments,deposits:db.deposits,withdrawals:db.withdrawals,disputes:db.disputes,proofs:db.proofs,settings:db.settings,audit:db.audit.slice(-100)});
});

app.post("/api/admin/create-tournament",requireAdmin,(req,res)=>{
  const body=req.body;
  const t={
    id:id("trn"),title:safe(body.title),gameCategory:safe(body.gameCategory),gameMode:safe(body.gameMode),
    entryFee:Number(body.entryFee||0),maxPlayers:Number(body.maxPlayers||0),bannerUrl:safe(body.bannerUrl),
    perKillRate:Number(body.perKillRate||0),rank1Prize:Number(body.rank1Prize||0),
    tierBonuses:Array.isArray(body.tierBonuses)?body.tierBonuses.map(Number):[0,0,0,0,0],
    startAt:body.startAt||null,status:"OPEN",players:[],roomId:"",roomPass:"",
    roomReleasedAt:null,roomReleaseMinutes:Number(db.settings.roomReleaseMinutes||15),
    streamPlatform:"",streamUrl:"",results:[],createdAt:now()
  };
  if(!t.title || !t.gameCategory || !t.gameMode) return res.status(400).json({success:false,error:"Title, game and mode are required."});
  db.tournaments.push(t); save(); audit("CREATE_TOURNAMENT","admin",t); res.json({success:true,tournament:t});
});

app.post("/api/admin/payment-settings",requireAdmin,(req,res)=>{
  db.settings.upiId=safe(req.body.upiId); db.settings.qrUrl=safe(req.body.qrUrl); save(); audit("UPDATE_PAYMENT_SETTINGS","admin",db.settings); res.json({success:true,settings:db.settings});
});
app.post("/api/admin/loyalty-settings",requireAdmin,(req,res)=>{
  db.settings.loyaltyFreeMatches=Math.max(0,Number(req.body.freeMatches||10));
  db.settings.loyaltyWins=Math.max(0,Number(req.body.wins||5)); save(); audit("OVERRIDE_LOYALTY","admin",db.settings); res.json({success:true,settings:db.settings});
});
app.post("/api/admin/withdrawal-settings",requireAdmin,(req,res)=>{
  db.settings.minWithdrawal=Math.max(1,Number(req.body.minWithdrawal||50)); save(); res.json({success:true,settings:db.settings});
});
app.post("/api/admin/user-ban",requireAdmin,(req,res)=>{
  const p=db.players.find(x=>x.id===req.body.playerId); if(!p) return res.status(404).json({success:false,error:"Player not found."});
  p.isBanned=!!req.body.banned; if(p.isBanned) db.sessions=db.sessions.filter(s=>s.playerId!==p.id); save(); audit(p.isBanned?"BAN_PLAYER":"UNBAN_PLAYER","admin",{playerId:p.id}); res.json({success:true,player:publicPlayer(p)});
});
app.post("/api/admin/kick",requireAdmin,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) return res.status(404).json({success:false,error:"Tournament not found."});
  t.players=t.players.filter(x=>x!==req.body.playerId); save(); audit("KICK_PLAYER","admin",req.body); res.json({success:true,tournament:t});
});
app.post("/api/admin/release-room",requireAdmin,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) return res.status(404).json({success:false,error:"Tournament not found."});
  t.roomId=safe(req.body.roomId); t.roomPass=safe(req.body.roomPass); t.roomReleasedAt=now(); t.roomReleaseMinutes=Number(req.body.minutes||db.settings.roomReleaseMinutes||15); save();
  for(const pid of t.players) notify(pid,"Room Credentials Released",`Room ID: ${t.roomId} | Password: ${t.roomPass}`);
  audit("RELEASE_ROOM","admin",{tournamentId:t.id}); res.json({success:true,tournament:t});
});
app.post("/api/admin/force-start",requireAdmin,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) return res.status(404).json({success:false,error:"Tournament not found."});
  if(!t.players.length) return res.status(400).json({success:false,error:"At least one player is required."});
  t.status="STARTED"; t.forceStarted=true; save(); audit("FORCE_START","admin",{tournamentId:t.id,players:t.players.length}); res.json({success:true,tournament:t});
});
app.post("/api/admin/stream",requireAdmin,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) return res.status(404).json({success:false,error:"Tournament not found."});
  t.streamPlatform=safe(req.body.platform); t.streamUrl=safe(req.body.streamUrl); save(); audit("SET_STREAM","admin",req.body); res.json({success:true,tournament:t});
});
app.post("/api/admin/deposit",requireAdmin,(req,res)=>{
  try{
    const d=db.deposits.find(x=>x.id===req.body.requestId); if(!d) throw Error("Deposit not found.");
    if(d.status!=="PENDING") throw Error("Already processed.");
    d.status=req.body.action==="APPROVE"?"APPROVED":"REJECTED";
    if(d.status==="APPROVED"){ const p=db.players.find(x=>x.id===d.playerId); p.wallet+=d.amount; notify(p.id,"Deposit Approved",`₹${d.amount} wallet me credit hua.`); }
    save(); sync({type:"DEPOSIT_PROCESSED",...d}); res.json({success:true,deposit:d});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});
app.post("/api/admin/withdraw",requireAdmin,(req,res)=>{
  try{
    const w=db.withdrawals.find(x=>x.id===req.body.requestId); if(!w) throw Error("Withdrawal not found.");
    if(w.status!=="PENDING") throw Error("Already processed.");
    const p=db.players.find(x=>x.id===w.playerId);
    w.status=req.body.action==="APPROVE"?"APPROVED":"REJECTED";
    p.heldBalance=Math.max(0,(p.heldBalance||0)-w.amount);
    if(w.status==="REJECTED") p.wallet+=w.amount;
    notify(p.id,w.status==="APPROVED"?"Withdrawal Approved":"Withdrawal Rejected",w.status==="APPROVED"?`₹${w.amount} payout approved.`:`₹${w.amount} wallet me refund hua.`);
    save(); sync({type:"WITHDRAWAL_PROCESSED",...w}); res.json({success:true,withdrawal:w});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});
app.post("/api/admin/result",requireAdmin,(req,res)=>{
  try{
    const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) throw Error("Tournament not found.");
    const results=Array.isArray(req.body.results)?req.body.results:[];
    const killers=[...results].sort((a,b)=>Number(b.kills||0)-Number(a.kills||0));
    const bonuses=t.tierBonuses||[0,0,0,0,0];
    for(const r of results){
      const p=db.players.find(x=>x.id===r.playerId); if(!p) continue;
      const idx=killers.findIndex(x=>x.playerId===r.playerId);
      let prize=Number(r.kills||0)*Number(t.perKillRate||0);
      if(idx>=0 && idx<5) prize+=Number(bonuses[idx]||0);
      if(Number(r.rank)===1){ prize+=Number(t.rank1Prize||0); ensureWeekly(p); p.weekly.wins++; }
      p.wallet+=prize; r.prize=prize;
      ensureWeekly(p); if(t.entryFee===0) p.weekly.freeMatches=Math.max(p.weekly.freeMatches, p.weekly.freeMatches);
      notify(p.id,"Match Result",`Result settled. Prize: ₹${prize}`);
    }
    t.results=results; t.status="COMPLETED"; save(); audit("SETTLE_MATCH","admin",{tournamentId:t.id,results}); res.json({success:true,results});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});
app.post("/api/admin/dispute",requireAdmin,(req,res)=>{
  const d={id:id("dis"),...req.body,status:"RESOLVED",resolvedAt:now()}; db.disputes.push(d);
  if(d.playerId && d.adjustedKills!==undefined) {
    const proof=db.proofs.find(x=>x.id===d.proofId); if(proof) { proof.killsClaimed=Number(d.adjustedKills); proof.status="ADJUSTED"; }
  }
  save(); audit("RESOLVE_DISPUTE","admin",d); res.json({success:true,dispute:d});
});
app.post("/api/admin/proof-review",requireAdmin,(req,res)=>{
  const p=db.proofs.find(x=>x.id===req.body.proofId); if(!p) return res.status(404).json({success:false,error:"Proof not found."});
  p.status=safe(req.body.status||"REVIEWED").toUpperCase(); p.adminNote=safe(req.body.adminNote); save(); res.json({success:true,proof:p});
});
app.post("/api/admin/banner",requireAdmin,(req,res)=>{
  const t=db.tournaments.find(x=>x.id===req.body.tournamentId); if(!t) return res.status(404).json({success:false,error:"Tournament not found."});
  t.bannerUrl=safe(req.body.bannerUrl); save(); res.json({success:true,tournament:t});
});
app.post("/api/admin/maintenance",requireAdmin,(req,res)=>{
  db.settings.maintenance=!!req.body.enabled; save(); res.json({success:true,settings:db.settings});
});

/* Simple durable weekly rollover. */
setInterval(()=>{
  let changed=false, wk=weekKey();
  for(const p of db.players){ if(!p.weekly || p.weekly.weekKey!==wk){ p.weekly={freeMatches:0,wins:0,passGrantedFor:null,weekKey:wk}; changed=true; } }
  if(changed) save();
  db.sessions=db.sessions.filter(s=>s.expiresAt>Date.now());
}, 60*60*1000);

app.listen(PORT,()=>console.log(`${PORTAL_NAME} running on ${PORT}`));
