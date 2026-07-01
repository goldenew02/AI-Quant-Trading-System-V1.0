import { AegisDB } from "../server/db-core";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

async function run() {
  console.log("Running Auth KV Regression Tests...");
  let passed = 0;
  let failed = 0;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-auth-kv-"));
  const testEncryptionKey = crypto.randomBytes(32);
  
  // Seed DB first
  process.env.BOOTSTRAP_ADMIN_USER = "admin";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "Password123!";
  process.env.NODE_ENV = "development";

  const db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: true,
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  const sqliteDbPath = path.join(tmpDir, "aegis_secure.db");
  
  // Wait for the sqlite db to finish writing
  await new Promise(r => setTimeout(r, 100));
  
  let sqlite3;
  try {
    const sqlite3Module = await import("sqlite3");
    sqlite3 = sqlite3Module.default || sqlite3Module;
  } catch (err: any) {
    if (process.env.ALLOW_SQL_RESTORE_TEST_SKIP === "true" && process.env.NODE_ENV !== "production") {
      console.log("Native sqlite3 package is not active; skipping KV tests.");
      process.exit(0);
    }
    console.error("[FAIL] Native sqlite3 unavailable; Auth KV tests cannot run.");
    process.exit(1);
  }
  const sqliteDb = new sqlite3.Database(sqliteDbPath);
  
  await new Promise<void>((resolve, reject) => {
    sqliteDb.run("DELETE FROM aegis_kv WHERE key = 'database_state'", (err: any) => {
        if (err) reject(err);
        else resolve();
    });
  });

  sqliteDb.close();
  
  // Now try to load in production mode
  process.env.NODE_ENV = "production";
  try {
    const dbFail = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbFail.ready;
    failed++; console.error("[FAIL] Test AUTH-KV-1 Failed: DB init succeeded despite missing database_state in production");
  } catch (err: any) {
    if (err.message && err.message.includes("KV_STATE_INVALID")) {
      passed++; console.log("[PASS] Test AUTH-KV-1 Passed: Missing KV database_state failed-fast in production");
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-1 Failed: Incorrect error thrown", err);
    }
  }

  // Now try with ALLOW_KV_RESEED_ON_CORRUPTION=true
  process.env.ALLOW_KV_RESEED_ON_CORRUPTION = "true";
  
  try {
    const dbSuccess = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbSuccess.ready;
    passed++; console.log("[PASS] Test AUTH-KV-2 Passed: Reseed allowed by env flag");
  } catch (err: any) {
    failed++; console.error("[FAIL] Test AUTH-KV-2 Failed: DB init failed despite ALLOW_KV_RESEED_ON_CORRUPTION=true", err);
  }
  
  console.log(`Auth KV Tests Completed: ${passed} passed, ${failed} failed.`);
  if (failed === 0) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  } else {
    console.log(`[INFO] Temp dir kept for debugging: ${tmpDir}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
