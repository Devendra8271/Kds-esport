const ADMIN_EMAIL = "its.kds.dev@gmail.com";
const SHEET_ID = PropertiesService.getScriptProperties().getProperty("SHEET_ID") || "";
const SHEET_NAME = PropertiesService.getScriptProperties().getProperty("SHEET_NAME") || "KDS_Data";

function doGet() {
  return json_({success:true,service:"KDS E-sports Google Apps Script",time:new Date().toISOString()});
}
function doPost(e) {
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || "{}");
    switch(String(data.type||"")) {
      case "REGISTRATION": return registration_(data);
      case "FORGOT_PASSWORD": return forgot_(data);
      case "ADMIN_FORGOT_PASSWORD": return adminForgot_(data);
      default: appendRow_(String(data.type||"EVENT"), data); return json_({success:true,message:"Event logged"});
    }
  } catch(err) { return json_({success:false,error:String(err)}); }
}
function registration_(d) {
  const playerEmail=String(d.email||""); if(!playerEmail) throw new Error("Player email missing");
  const html='<div style="font-family:Arial;background:#0b0f14;color:#fff;padding:24px;border-radius:12px"><h2 style="color:#00e887">Welcome to KDS E-sports, '+escape_(d.name)+'</h2><p>Your registration was successful.</p><p><b>Email:</b> '+escape_(playerEmail)+'</p><p><b>Mobile:</b> '+escape_(d.mobile)+'</p><p><b>Referral Code:</b> '+escape_(d.referralCode)+'</p><p>KDS E-sports Team</p></div>';
  MailApp.sendEmail({to:playerEmail,subject:"🎉 Registration Successful - KDS E-sports",htmlBody:html,body:"Welcome to KDS E-sports. Registration successful."});
  MailApp.sendEmail({to:ADMIN_EMAIL,subject:"🔔 New Player Registered - KDS E-sports",htmlBody:'<h2>New Player</h2><p>Name: '+escape_(d.name)+'</p><p>Email: '+escape_(playerEmail)+'</p><p>Mobile: '+escape_(d.mobile)+'</p><p>DOB: '+escape_(d.dob)+'</p><p>Gender: '+escape_(d.gender)+'</p><p>Referral: '+escape_(d.referralCode)+'</p>',body:"New player registered: "+d.name});
  appendRow_("REGISTRATION",d); return json_({success:true,message:"Registration emails sent"});
}
function forgot_(d) {
  const email=String(d.email||""), link=String(d.resetLink||""); if(!email||!link) throw new Error("Email/reset link missing");
  MailApp.sendEmail({to:email,subject:"🔑 Password Reset Link - KDS E-sports",htmlBody:'<div style="font-family:Arial;padding:24px"><h2>KDS E-sports Password Reset</h2><p>Hello <b>'+escape_(d.name||"Player")+'</b>,</p><p>Reset your password using the button below.</p><p><a href="'+escapeAttr_(link)+'" style="background:#00e887;color:#000;padding:12px 18px;text-decoration:none;border-radius:7px;font-weight:bold">Reset Password</a></p><p>This link expires in 15 minutes.</p></div>',body:"Password reset link: "+link});
  appendRow_("FORGOT_PASSWORD",d); return json_({success:true,message:"Reset email sent"});
}
function adminForgot_(d) {
  const link=String(d.resetLink||"");
  MailApp.sendEmail({to:ADMIN_EMAIL,subject:"🔐 KDS Master Admin Recovery",htmlBody:'<p>Admin recovery request received.</p><p><a href="'+escapeAttr_(link)+'">Open recovery page</a></p><p>Use your server-side ADMIN_PASSWORD configuration to change the password.</p>',body:"Admin recovery request. Link: "+link});
  appendRow_("ADMIN_FORGOT_PASSWORD",d); return json_({success:true});
}
function appendRow_(type,d) {
  if(!SHEET_ID) return;
  const ss=SpreadsheetApp.openById(SHEET_ID);
  const sh=ss.getSheetByName(SHEET_NAME)||ss.insertSheet(SHEET_NAME);
  if(sh.getLastRow()===0) sh.appendRow(["timestamp","type","payload"]);
  sh.appendRow([new Date(),type,JSON.stringify(d)]);
}
function escape_(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr_(s){return escape_(s).replace(/`/g,"&#96;");}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
