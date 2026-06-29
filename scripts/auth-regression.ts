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

function fingerprintTree(dirPath: string): string {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    let content = "";
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dirPath, f.name);
      if (f.isDirectory()) {
        content += fingerprintTree(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        content += `${f.name}|${stat.size}|${hashFile(fullPath)}\n`;
      }
    }
    return crypto.createHash("sha256").update(content).digest("hex");
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
      console.log("✅ Test 1 Passed: passwordHash preserved when SYNC_ON_BOOT=false");
      passed++;
    } else {
      console.error("❌ Test 1 Failed: passwordHash was overwritten!");
      failed++;
    }

    if (adminUser?.totpSecret === originalTotpSecretEncrypted) {
      console.log("✅ Test 2 Passed: totpSecret preserved when SYNC_ON_BOOT=false");
      passed++;
    } else {
      console.error("❌ Test 2 Failed: totpSecret was overwritten!");
      failed++;
    }

    if (adminUser?.mustEnrollTotp === false) {
      console.log("✅ Test 3 Passed: mustEnrollTotp preserved as false");
      passed++;
    } else {
      console.error("❌ Test 3 Failed: mustEnrollTotp was reset!");
      failed++;
    }

    // Stage 3: Boot system with SYNC_ON_BOOT = true
    process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "true";
    process.env.ADMIN_TOTP_SYNC_ON_BOOT = "true";

    const testDb2 = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: true, encryptionKey: testEncryptionKey });
    await testDb2.ready;

    adminUser = testDb2.get().users.find(u => u.username === "admin");

    if (adminUser?.passwordHash !== originalPasswordHash && verifyPassword(newRandPass, adminUser?.passwordHash || "")) {
      console.log("✅ Test 4 Passed: passwordHash overwritten when SYNC_ON_BOOT=true");
      passed++;
    } else {
      console.error("❌ Test 4 Failed: passwordHash not updated correctly!");
      failed++;
    }

    if (adminUser?.totpSecret !== originalTotpSecretEncrypted && decryptSecret(adminUser?.totpSecret || "") === newRandTotp) {
      console.log("✅ Test 5 Passed: totpSecret overwritten when SYNC_ON_BOOT=true");
      passed++;
    } else {
      console.error("❌ Test 5 Failed: totpSecret not updated correctly!");
      failed++;
    }

    if (adminUser?.mustEnrollTotp === false) {
      console.log("✅ Test 6 Passed: mustEnrollTotp is false after sync with provided TOTP");
      passed++;
    } else {
      console.error("❌ Test 6 Failed: mustEnrollTotp state is incorrect!");
      failed++;
    }
    
    // Stage 4: Assert root files unchanged
    const rootEnvAfter = hashFile(rootEnvPath);
    const rootDataAfter = fingerprintTree(rootDataPath);
    
    if (rootEnvBefore === rootEnvAfter) {
      console.log("✅ Test 7 Passed: Root .env unchanged");
      passed++;
    } else {
      console.error("❌ Test 7 Failed: Root .env was modified!");
      failed++;
    }

    if (rootDataBefore === rootDataAfter) {
      console.log("✅ Test 8 Passed: Root data/ unchanged");
      passed++;
    } else {
      console.error("❌ Test 8 Failed: Root data/ was modified!");
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
