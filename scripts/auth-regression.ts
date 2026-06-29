import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret } from "../server/db-core";

function statOrNull(filepath: string) {
  try {
    return fs.statSync(filepath).mtimeMs;
  } catch (e) {
    return null;
  }
}

async function runTests() {
  console.log("Running Auth Regression Tests (with real DB instance)...");
  let passed = 0;
  let failed = 0;

  const rootEnvPath = path.join(process.cwd(), ".env");
  const rootDataPath = path.join(process.cwd(), "data");
  const rootEnvBefore = statOrNull(rootEnvPath);
  const rootDataBefore = statOrNull(rootDataPath);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-auth-reg-"));
  process.env.DB_DIR = tempDir;
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

  const randPass = crypto.randomBytes(16).toString("hex");
  const randTotp = crypto.randomBytes(16).toString("base64");

  try {
    // Stage 1: Initialize existing DB state manually to simulate an older deployment
    const originalPasswordHash = hashPassword(randPass);
    const originalTotpSecretEncrypted = encryptSecret(randTotp);
    
    // We create a dummy DB instance just to write this initial state to disk
    const { AegisDB } = await import("../server/db-core");
    const initialDb = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: false });
    await initialDb.ready;
    initialDb.get().users = [{
      username: "admin",
      passwordHash: originalPasswordHash,
      role: "admin",
      totpSecret: originalTotpSecretEncrypted,
      isActive: true,
      mustEnrollTotp: false
    }];
    initialDb.save();

    console.log("Stage 1: Seeded existing database with custom user credentials.");

    // Stage 2: Boot system with different env credentials, but SYNC_ON_BOOT = false
    const newRandPass = crypto.randomBytes(16).toString("hex");
    const newRandTotp = crypto.randomBytes(16).toString("base64");
    process.env.BOOTSTRAP_ADMIN_USER = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = newRandPass;
    process.env.BOOTSTRAP_ADMIN_TOTP_SECRET = newRandTotp;
    process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "false";
    process.env.ADMIN_TOTP_SYNC_ON_BOOT = "false";

    const testDb1 = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: true });
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

    const testDb2 = new AegisDB({ dbDir: tempDir, autoBootstrapEnv: true });
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
    const rootEnvAfter = statOrNull(rootEnvPath);
    const rootDataAfter = statOrNull(rootDataPath);
    
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
