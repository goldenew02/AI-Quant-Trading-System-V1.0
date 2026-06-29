import fs from "fs";
import path from "path";
import os from "os";
import { AegisDB, hashPassword, verifyPassword, encryptSecret, decryptSecret } from "../server/db";

async function runTests() {
  console.log("Running Auth Regression Tests (with real DB instance)...");
  let passed = 0;
  let failed = 0;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-auth-reg-"));
  process.env.DB_DIR = tempDir;

  try {
    // Stage 1: Initialize existing DB state manually to simulate an older deployment
    const dbFile = path.join(tempDir, "aegis.db");
    
    // Original credentials that the user set via UI and wants to KEEP
    const originalPasswordHash = hashPassword("UserCustomPassword123!");
    const originalTotpSecretEncrypted = encryptSecret("ORIGINAL_TOTP_SECRET_123");
    
    const mockInitialData = {
      users: [{
        username: "admin",
        passwordHash: originalPasswordHash,
        role: "admin",
        totpSecret: originalTotpSecretEncrypted,
        isActive: true,
        mustEnrollTotp: false
      }]
    };
    
    // We create a dummy DB instance just to write this initial state to disk
    const initialDb = new AegisDB();
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
    process.env.BOOTSTRAP_ADMIN_USER = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "EnvPasswordThatShouldBeIgnored";
    process.env.BOOTSTRAP_ADMIN_TOTP_SECRET = "ENV_TOTP_THAT_SHOULD_BE_IGNORED";
    process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "false";
    process.env.ADMIN_TOTP_SYNC_ON_BOOT = "false";

    const testDb1 = new AegisDB();
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

    const testDb2 = new AegisDB();
    await testDb2.ready;

    adminUser = testDb2.get().users.find(u => u.username === "admin");

    if (adminUser?.passwordHash !== originalPasswordHash && verifyPassword("EnvPasswordThatShouldBeIgnored", adminUser?.passwordHash || "")) {
      console.log("✅ Test 4 Passed: passwordHash overwritten when SYNC_ON_BOOT=true");
      passed++;
    } else {
      console.error("❌ Test 4 Failed: passwordHash not updated correctly!");
      failed++;
    }

    if (adminUser?.totpSecret !== originalTotpSecretEncrypted && decryptSecret(adminUser?.totpSecret || "") === "ENV_TOTP_THAT_SHOULD_BE_IGNORED") {
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
