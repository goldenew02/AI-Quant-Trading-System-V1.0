import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

function hashFile(filepath: string): string {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filepath)).digest("hex");
  } catch {
    return "missing";
  }
}

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

function fingerprintTree(dirPath: string): string {
  try {
    const entries = walk(dirPath).map(file => {
      const rel = path.relative(dirPath, file).replace(/\\/g, "/");
      const stat = fs.statSync(file);
      const hash = hashFile(file);
      return `${rel}|${stat.size}|${hash}`;
    }).sort().join("\n");
    return crypto.createHash("sha256").update(entries).digest("hex");
  } catch {
    return "missing_dir";
  }
}

async function runTests() {
  console.log("Running Auth Regression Tests (with real DB instance)...");
  let passed = 0;
  let failed = 0;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-auth-reg-"));
  process.env.DB_DIR = tempDir;
  
  const testEncryptionKey = crypto.randomBytes(32);
  delete process.env.ENCRYPTION_KEY;

  const { AegisDB, setEncryptionKey, encryptSecret, hashPassword, verifyPassword, decryptSecret } = await import("../server/db-core");
  setEncryptionKey(testEncryptionKey);

  const rootEnvPath = path.join(process.cwd(), ".env");
  const rootDataPath = path.join(process.cwd(), "data");
  const rootEnvBefore = hashFile(rootEnvPath);
  const rootDataBefore = fingerprintTree(rootDataPath);

  const randPass = crypto.randomBytes(16).toString("hex");
  const randTotp = crypto.randomBytes(16).toString("base64");

  try {
    // Stage 1: Initialize existing DB state manually to simulate an older deployment
    const originalPasswordHash = hashPassword(randPass);
    const originalTotpSecretEncrypted = encryptSecret(randTotp);
    
    // We create a dummy DB instance just to write this initial state to disk
    const initialDb = new AegisDB({ 
      dbDir: tempDir, 
      autoBootstrapEnv: false,
      encryptionKey: testEncryptionKey,
      seedUsers: [{
        username: "admin",
        passwordHash: originalPasswordHash,
        role: "admin",
        totpSecret: originalTotpSecretEncrypted,
        isActive: true,
        mustEnrollTotp: false
      }]
    });
    await initialDb.ready;

    console.log("Stage 1: Seeded existing database with custom user credentials.");

    // Stage 2: Boot system with different env credentials, but SYNC_ON_BOOT = false
    const newRandPass = crypto.randomBytes(16).toString("hex");
    const newRandTotp = crypto.randomBytes(16).toString("base64");
    process.env.BOOTSTRAP_ADMIN_USER = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = newRandPass;
    process.env.BOOTSTRAP_ADMIN_TOTP_SECRET = newRandTotp;
    process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "false";
    process.env.ADMIN_TOTP_SYNC_ON_BOOT = "false";

    const testDb1 = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: true, encryptionKey: testEncryptionKey });
    await testDb1.ready;
    
    let adminUser = testDb1.get().users.find(u => u.username === "admin");
    
    // Check if original credentials were preserved
    if (adminUser?.passwordHash === originalPasswordHash) {
      console.log("[PASS] Test 1 Passed: passwordHash preserved when SYNC_ON_BOOT=false");
      passed++;
    } else {
      console.error("[FAIL] Test 1 Failed: passwordHash was overwritten!");
      failed++;
    }

    if (adminUser?.totpSecret === originalTotpSecretEncrypted) {
      console.log("[PASS] Test 2 Passed: totpSecret preserved when SYNC_ON_BOOT=false");
      passed++;
    } else {
      console.error("[FAIL] Test 2 Failed: totpSecret was overwritten!");
      failed++;
    }

    if (adminUser?.mustEnrollTotp === false) {
      console.log("[PASS] Test 3 Passed: mustEnrollTotp preserved as false");
      passed++;
    } else {
      console.error("[FAIL] Test 3 Failed: mustEnrollTotp was reset!");
      failed++;
    }

    // Stage 3: Boot system with SYNC_ON_BOOT = true
    process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "true";
    process.env.ADMIN_TOTP_SYNC_ON_BOOT = "true";

    const testDb2 = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: true, encryptionKey: testEncryptionKey });
    await testDb2.ready;

    adminUser = testDb2.get().users.find(u => u.username === "admin");

    if (adminUser?.passwordHash !== originalPasswordHash && verifyPassword(newRandPass, adminUser?.passwordHash || "")) {
      console.log("[PASS] Test 4 Passed: passwordHash overwritten when SYNC_ON_BOOT=true");
      passed++;
    } else {
      console.error("[FAIL] Test 4 Failed: passwordHash not updated correctly!");
      failed++;
    }

    if (adminUser?.totpSecret !== originalTotpSecretEncrypted && decryptSecret(adminUser?.totpSecret || "") === newRandTotp) {
      console.log("[PASS] Test 5 Passed: totpSecret overwritten when SYNC_ON_BOOT=true");
      passed++;
    } else {
      console.error("[FAIL] Test 5 Failed: totpSecret not updated correctly!");
      failed++;
    }

    if (adminUser?.mustEnrollTotp === false) {
      console.log("[PASS] Test 6 Passed: mustEnrollTotp is false after sync with provided TOTP");
      passed++;
    } else {
      console.error("[FAIL] Test 6 Failed: mustEnrollTotp state is incorrect!");
      failed++;
    }
    
    // Stage 4: Preauth Session Lifecycle
    const preauthIdHash = crypto.createHash("sha256").update("test-preauth").digest("hex");
    await testDb2.insertPreauthSession(preauthIdHash, "admin", "admin", Date.now() + 60000, "127.0.0.1", "test-agent");
    
    const preauthSession = await testDb2.validatePreauthSessionAsync(preauthIdHash, "127.0.0.1", "test-agent");
    if (preauthSession && preauthSession.username === "admin") {
      console.log("[PASS] Test 7 Passed: Preauth session validated");
      passed++;
    } else {
      console.error("[FAIL] Test 7 Failed: Preauth session validation failed");
      failed++;
    }

    await testDb2.consumePreauthSessionAsync(preauthIdHash);
    console.log("[PASS] Test 8 Passed: Preauth session consumed for the first time");
    passed++;

    let secondConsumeFailed = false;
    try {
      await testDb2.consumePreauthSessionAsync(preauthIdHash);
    } catch (e) {
      secondConsumeFailed = true;
    }
    
    if (secondConsumeFailed) {
      console.log("[PASS] Test 9 Passed: Preauth session double-consume rejected");
      passed++;
    } else {
      console.error("[FAIL] Test 9 Failed: Preauth session double-consume succeeded!");
      failed++;
    }

    // Stage 5: Assert root files unchanged
    const rootEnvAfter = hashFile(rootEnvPath);
    const rootDataAfter = fingerprintTree(rootDataPath);
    
    if (rootEnvBefore === rootEnvAfter) {
      console.log("[PASS] Test 10 Passed: Root .env unchanged");
      passed++;
    } else {
      console.error("[FAIL] Test 10 Failed: Root .env was modified!");
      failed++;
    }

    if (rootDataBefore === rootDataAfter) {
      console.log("[PASS] Test 11 Passed: Root data/ unchanged");
      passed++;
    } else {
      console.error("[FAIL] Test 11 Failed: Root data/ was modified!");
      console.error("Before:", rootDataBefore);
      console.error("After :", rootDataAfter);
      failed++;
    }

  } catch (err) {
    console.error("Exception during tests:", err);
    failed++;
  } finally {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log(`\nTests Completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
