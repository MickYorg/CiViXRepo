// Tiny App Store Connect API client (key + issuer from ~/.civix-asc/config,
// never in the repo). Usage: node scripts/asc.js GET "/v1/builds?filter%5Bapp%5D=6815834665"
// App 6815834665 = CiViX (com.mycivix.ios); internal TestFlight group "Me"
// has access to all builds automatically.
const fs = require('fs'), crypto = require('crypto'), os = require('os');
const cfg = Object.fromEntries(fs.readFileSync(os.homedir() + '/.civix-asc/config', 'utf8').trim().split('\n').map(l => l.split('=')));
const key = fs.readFileSync(`${os.homedir()}/.civix-asc/AuthKey_${cfg.ASC_KEY_ID}.p8`);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'ES256', kid: cfg.ASC_KEY_ID, typ: 'JWT' });
const body = b64({ iss: cfg.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const [method, path, data] = process.argv.slice(2);
fetch('https://api.appstoreconnect.apple.com' + path, {
  method, headers: { Authorization: `Bearer ${head}.${body}.${sig}`, 'Content-Type': 'application/json' },
  body: data || undefined,
}).then(async r => { console.log(r.status); console.log(await r.text()); });
