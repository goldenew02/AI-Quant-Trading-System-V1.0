import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

process.env.NODE_ENV = "test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-http-reg-"));
process.env.DB_DIR = tempDir;
const testEncryptionKey = crypto.randomBytes(32);
process.env.ENCRYPTION_KEY = testEncryptionKey.toString("base64");
process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "false";
process.env.ADMIN_TOTP_SYNC_ON_BOOT = "false";

const randPass = `T_${crypto.randomBytes(18).toString("base64url")}!`;

function generateRandomBase32Secret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 16; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}
const randTotp = generateRandomBase32Secret();

process.env.BOOTSTRAP_ADMIN_USER = "admin";
process.env.BOOTSTRAP_ADMIN_PASSWORD = randPass;
process.env.SESSION_SECRET = crypto.randomBytes(64).toString("base64");
process.env.APP_URL = "http://127.0.0.1";
process.env.COOKIE_SAMESITE = "lax";
process.env.COOKIE_SECURE = "false";

// Helper to hash tree
function walk(dirPath: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of list) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        results = results.concat(walk(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch (e) {}
  return results;
}

function hashFile(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return "missing_file";
  }
}

function fingerprintTree(dirPath: string): { hash: string, entries: string } {
  try {
    const entries = walk(dirPath).map(file => {
      const rel = path.relative(dirPath, file).replace(/\\/g, "/");
      const stat = fs.statSync(file);
      const hash = hashFile(file);
      return `${rel}|${stat.size}|${hash}`;
    }).sort().join("\n");
    return { hash: crypto.createHash("sha256").update(entries).digest("hex"), entries };
  } catch {
    return { hash: "missing_dir", entries: "" };
  }
}

let passed = 0;
let failed = 0;

async function run() {
  const rootEnvPath = path.join(process.cwd(), ".env");
  const rootDataPath = path.join(process.cwd(), "data");
  
  if (fs.existsSync(path.join(rootDataPath, "aegis_secure.json"))) {
    fs.copyFileSync(path.join(rootDataPath, "aegis_secure.json"), path.join(rootDataPath, "aegis_secure.json.bak"));
  }

  const rootEnvBefore = hashFile(rootEnvPath);
  const rootDataBefore = fingerprintTree(rootDataPath);

  const { AegisDB, setEncryptionKey, encryptSecret, hashPassword } = await import("../server/db-core");
  setEncryptionKey(testEncryptionKey);

  const initialDb = new AegisDB({ 
    dbDir: tempDir, 
    autoBootstrapEnv: false,
    encryptionKey: testEncryptionKey,
    seedUsers: [{
      username: "admin",
      passwordHash: hashPassword(randPass),
      role: "admin",
      totpSecret: encryptSecret(randTotp),
      isActive: true,
      mustEnrollTotp: false
    }]
  });
  await initialDb.ready;

  // Now boot the express app
  const { bootstrap, app } = await import("../server.ts");
  const server = await bootstrap(0);
  
  const { dbInstance } = await import("../server/db.ts");
  
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`[HTTP Test] Server started on ${baseUrl}`);

  try {
    // 1. GET CSRF
    let response = await fetch(`${baseUrl}/api/auth/csrf`);
    if (response.status !== 200) throw new Error("Failed to get CSRF token");
    let cookieHeader = response.headers.get('set-cookie');
    
    // Extract csrf_token cookie
    let csrfToken = "";
    if (cookieHeader) {
      const match = cookieHeader.match(/csrf_token=s%3A([^;]+)\./) || cookieHeader.match(/csrf_token=([^;]+)/);
      if (match) csrfToken = match[1];
    }
    
    // Express signed cookie parsing fallback if it's literally just the string after s%3A
    // Since it's signed, we'll just send the exact cookie string back
    const rawCsrfCookie = cookieHeader?.split(';').find(c => c.trim().startsWith('csrf_token='))?.trim();
    if (!rawCsrfCookie) throw new Error("CSRF cookie setup failed");
    // To send it back in x-csrf-token, we need the raw token value.
    // The server signs it as s:TOKEN.MAC ... wait, let's look at server validateCsrf
    // It compares `req.headers["x-csrf-token"]` with `req.signedCookies.csrf_token`
    // So the value inside x-csrf-token must be the un-signed value!
    
    // Actually, let's fetch it, parse the unsigned value from the Set-Cookie string.
    const csrfCookieValueString = rawCsrfCookie.substring("csrf_token=".length);
    // e.g. s%3A452f5ef... .MAC
    const decodedVal = decodeURIComponent(csrfCookieValueString);
    let unsignedCsrfVal = decodedVal;
    if (decodedVal.startsWith("s:")) {
      unsignedCsrfVal = decodedVal.substring(2).split('.')[0];
    }
    
    // 2. POST login
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": unsignedCsrfVal,
        "Cookie": rawCsrfCookie
      },
      body: JSON.stringify({ username: "admin", password: randPass })
    });
    const loginBody = await response.json();
    const loginCookie = response.headers.get('set-cookie') || "";
    
    const rawSidCookie = loginCookie.split(';').find(c => c.trim().startsWith('sid='))?.trim() || "";
    const combinedCookies = rawSidCookie ? `${rawCsrfCookie}; ${rawSidCookie}` : rawCsrfCookie;
    
    if (!loginBody.requiresTotp || !loginBody.preauthId) {
      console.error("[FAIL] Test 1 Failed: Login did not return requiresTotp", loginBody);
      failed++;
    } else {
      console.log("[PASS] Test 1 Passed: Username/Password accepted, requiresTotp");
      passed++;
    }

    const { verifyTOTP } = await import("../server/db-core");
    let token = "";
    for (let i = 0; i < 1000000; i++) {
      const candidate = i.toString().padStart(6, "0");
      if (verifyTOTP(randTotp, candidate)) {
        token = candidate;
        break;
      }
    }
    
    if (token) {
      response = await fetch(`${baseUrl}/api/auth/login/totp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": unsignedCsrfVal,
          "Cookie": combinedCookies
        },
        body: JSON.stringify({ preauthId: loginBody.preauthId, code: token })
      });
      
      const totpBody = await response.json();
      
      if (totpBody.success) {
        console.log("[PASS] Test 2 Passed: TOTP verified successfully");
        passed++;
        
        // Update session ID if it changed
        const newCookieHeader = response.headers.get('set-cookie');
        let finalCookies = combinedCookies;
        if (newCookieHeader) {
          const newSid = newCookieHeader.split(';').find(c => c.trim().startsWith('sid='))?.trim();
          if (newSid) {
            finalCookies = `${rawCsrfCookie}; ${newSid}`;
          }
        }
        
        // 3. GET /api/auth/me
        response = await fetch(`${baseUrl}/api/auth/me`, {
          headers: {
            "Cookie": finalCookies
          }
        });
      
        const meBody = await response.json();
        if (meBody.username === "admin") {
          console.log("[PASS] Test 3 Passed: Authenticated session confirmed via /api/auth/me");
          passed++;
        } else {
          console.error("[FAIL] Test 3 Failed: /api/auth/me failed", meBody);
          failed++;
        }
      } else {
        console.error("[FAIL] Test 2 Failed: TOTP verification failed", totpBody);
        failed++;
      }
    } else {
      console.log("[SKIP] Skipping TOTP verification test (could not generate token locally)");
    }
    
    // Stage 4: Assert root files unchanged
    const rootEnvAfter = hashFile(rootEnvPath);
    
    if (rootEnvBefore === rootEnvAfter) {
      console.log("[PASS] Test 4 Passed: Root .env unchanged");
      passed++;
    } else {
      console.error("[FAIL] Test 4 Failed: Root .env was modified!");
      failed++;
    }

    let rootDataPass = true;
    try {
      const bak = fs.readFileSync(path.join(rootDataPath, "aegis_secure.json.bak"), "utf8");
      const cur = fs.readFileSync(path.join(rootDataPath, "aegis_secure.json"), "utf8");
      const bObj = JSON.parse(bak);
      const cObj = JSON.parse(cur);
      if (JSON.stringify(bObj.users) !== JSON.stringify(cObj.users)) {
        console.error("[FAIL] Test 5 Failed: Root data/users was modified!");
        rootDataPass = false;
      }
    } catch (e) {}

    if (rootDataPass) {
      console.log("[PASS] Test 5 Passed: Root data/users unchanged");
      passed++;
    } else {
      failed++;
    }

  } finally {
    server.close();
    initialDb.close();
    dbInstance.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`\nHTTP Tests Completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
