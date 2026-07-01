import { AegisDB, encryptSecret } from "../server/db-core";
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
  
  // 1. 构造已有 admin 用户，包含 passwordHash、totpSecret、mustEnrollTotp=false、passwordVersion
  const originalPassword = `test-${crypto.randomBytes(16).toString("hex")}`;
  const replacementPassword = `test-${crypto.randomBytes(16).toString("hex")}`;
  process.env.BOOTSTRAP_ADMIN_USER = "admin";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = originalPassword;
  process.env.NODE_ENV = "development";

  const db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: true,
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  
  // Set mustEnrollTotp=false and a fake totpSecret using encryptSecret
  const dbData = db.get();
  const adminBefore = dbData.users.find(u => u.username === "admin");
  if (adminBefore) {
    adminBefore.mustEnrollTotp = false;
    adminBefore.totpSecret = encryptSecret("FAKE_SECRET_123");
    db.save();
  }
  const passwordHashBefore = adminBefore?.passwordHash;
  const totpSecretBefore = adminBefore?.totpSecret;
  const passwordVersionBefore = adminBefore?.passwordVersion;
  
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
  const sqliteDbPath = path.join(tmpDir, "aegis_secure.db");
  const sqliteDb = new sqlite3.Database(sqliteDbPath);
  
  // Helper to check DB value
  const getRawDatabaseState = (): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      sqliteDb.get("SELECT value FROM aegis_kv WHERE key = 'database_state'", (err: any, row: any) => {
        if (err) return reject(err);
        resolve(row ? row.value : null);
      });
    });
  };

  // 2. 设置 ADMIN_PASSWORD_SYNC_ON_BOOT=false 和 ADMIN_TOTP_SYNC_ON_BOOT=false
  process.env.ADMIN_PASSWORD_SYNC_ON_BOOT = "false";
  process.env.ADMIN_TOTP_SYNC_ON_BOOT = "false";
  
  // 3. 修改环境变量中的 bootstrap password / totp
  process.env.BOOTSTRAP_ADMIN_PASSWORD = replacementPassword;
  
  // 4. 重启 DB
  const dbSyncFalse = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: true,
    encryptionKey: testEncryptionKey
  });
  await dbSyncFalse.ready;
  
  // 5. 断言上述四个字段完全不变
  const adminAfter = dbSyncFalse.get().users.find(u => u.username === "admin");
  if (
    adminAfter?.passwordHash === passwordHashBefore &&
    adminAfter?.totpSecret === totpSecretBefore &&
    adminAfter?.mustEnrollTotp === false &&
    adminAfter?.passwordVersion === passwordVersionBefore
  ) {
    passed++; console.log("[PASS] Test AUTH-KV-PRESERVE Passed: Auth fields completely preserved when sync disabled");
  } else {
    failed++; console.error("[FAIL] Test AUTH-KV-PRESERVE Failed: Auth fields were changed!", {
      passwordHashChanged: adminAfter?.passwordHash !== passwordHashBefore,
      totpSecretChanged: adminAfter?.totpSecret !== totpSecretBefore,
      mustEnrollChanged: adminAfter?.mustEnrollTotp !== false,
      passwordVersionChanged: adminAfter?.passwordVersion !== passwordVersionBefore
    });
  }
  
  // 6. 破坏 database_state (JSON parse error)，生产环境应 fail-fast
  await new Promise<void>((resolve, reject) => {
    sqliteDb.run("UPDATE aegis_kv SET value = value || 'INVALID' WHERE key = 'database_state'", (err: any) => {
        if (err) reject(err);
        else resolve();
    });
  });

  process.env.NODE_ENV = "production";
  try {
    const dbFailJson = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbFailJson.ready;
    failed++; console.error("[FAIL] Test AUTH-KV-1 Failed: DB init succeeded despite invalid JSON database_state in production");
  } catch (err: any) {
    if (err.message && err.message.includes("KV_STATE_INVALID")) {
      passed++; console.log("[PASS] Test AUTH-KV-1 Passed: Invalid JSON database_state failed-fast in production");
      
      // Verify no side-effect (no re-seed happened)
      const rawAfter = await getRawDatabaseState();
      if (rawAfter && rawAfter.endsWith('INVALID')) {
        const fixedJson = JSON.parse(rawAfter.replace('INVALID', ''));
        const adminRaw = fixedJson.users.find((u: any) => u.username === "admin");
        if (adminRaw?.passwordHash === passwordHashBefore && adminRaw?.totpSecret === totpSecretBefore && adminRaw?.mustEnrollTotp === false && adminRaw?.passwordVersion === passwordVersionBefore) {
          passed++; console.log("[PASS] Test AUTH-KV-1-SIDE-EFFECT Passed: Auth fields unchanged after JSON fail-fast");
        } else {
          failed++; console.error("[FAIL] Test AUTH-KV-1-SIDE-EFFECT Failed: Auth fields were changed");
        }
      } else {
        failed++; console.error("[FAIL] Test AUTH-KV-1-SIDE-EFFECT Failed: DB state was overwritten!");
      }
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-1 Failed: Incorrect error thrown", err);
    }
  }

  // 7. 删除 database_state
  await new Promise<void>((resolve, reject) => {
    sqliteDb.run("DELETE FROM aegis_kv WHERE key = 'database_state'", (err: any) => {
        if (err) reject(err);
        else resolve();
    });
  });

  try {
    const dbFailMissing = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbFailMissing.ready;
    failed++; console.error("[FAIL] Test AUTH-KV-2 Failed: DB init succeeded despite missing database_state in production");
  } catch (err: any) {
    if (err.message && err.message.includes("KV_STATE_INVALID")) {
      passed++; console.log("[PASS] Test AUTH-KV-2 Passed: Missing KV database_state failed-fast in production");
      
      // Verify no side-effect (no re-seed happened)
      const rawAfter = await getRawDatabaseState();
      if (rawAfter === null) {
        passed++; console.log("[PASS] Test AUTH-KV-2-SIDE-EFFECT Passed: KV still missing, no seed overwritten");
      } else {
        failed++; console.error("[FAIL] Test AUTH-KV-2-SIDE-EFFECT Failed: DB state was overwritten with seed!");
      }
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-2 Failed: Incorrect error thrown", err);
    }
  }

  // 8. Test single variable override (should still fail-fast)
  process.env.ALLOW_KV_RESEED_ON_CORRUPTION = "true";
  delete process.env.CONFIRM_KV_RESEED_RESETS_AUTH_STATE;
  try {
    const dbSingleVar = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbSingleVar.ready;
    failed++; console.error("[FAIL] Test AUTH-KV-OVERRIDE-1 Failed: DB init succeeded with only one override flag");
  } catch (err: any) {
    if (err.message && err.message.includes("KV_STATE_INVALID")) {
      passed++; console.log("[PASS] Test AUTH-KV-OVERRIDE-1 Passed: Single override variable failed-fast correctly");
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-OVERRIDE-1 Failed: Incorrect error thrown", err);
    }
  }
  
  delete process.env.ALLOW_KV_RESEED_ON_CORRUPTION;
  process.env.CONFIRM_KV_RESEED_RESETS_AUTH_STATE = "YES_I_UNDERSTAND";
  try {
    const dbSingleVar2 = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbSingleVar2.ready;
    failed++; console.error("[FAIL] Test AUTH-KV-OVERRIDE-2 Failed: DB init succeeded with only one override flag");
  } catch (err: any) {
    if (err.message && err.message.includes("KV_STATE_INVALID")) {
      passed++; console.log("[PASS] Test AUTH-KV-OVERRIDE-2 Passed: Single override variable failed-fast correctly");
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-OVERRIDE-2 Failed: Incorrect error thrown", err);
    }
  }

  // 9. 显式确认双变量环境变量允许再尝试
  process.env.ALLOW_KV_RESEED_ON_CORRUPTION = "true";
  process.env.CONFIRM_KV_RESEED_RESETS_AUTH_STATE = "YES_I_UNDERSTAND";
  
  try {
    const dbSuccess = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    await dbSuccess.ready;
    passed++; console.log("[PASS] Test AUTH-KV-3 Passed: Reseed allowed by both env flags");

    // Test AUTH-KV-OVERRIDE-AUDIT
    // We must verify that the audit log was persisted to SQLite, not just in memory.
    
    // Create a new DB instance to read from SQLite
    const dbVerify = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: false, // Don't bootstrap again
      encryptionKey: testEncryptionKey
    });
    await dbVerify.ready;

    const auditLogs = dbVerify.get().securityAuditLogs;
    if (auditLogs && auditLogs.some(l => l.action === "KV_RESEED_OVERRIDE_USED")) {
      passed++; console.log("[PASS] Test AUTH-KV-OVERRIDE-AUDIT Passed: Audit log for reseed override persisted to SQLite");
    } else {
      failed++; console.error("[FAIL] Test AUTH-KV-OVERRIDE-AUDIT Failed: Audit log for reseed override not found after reload");
    }

  } catch (err: any) {
    failed++; console.error("[FAIL] Test AUTH-KV-3 Failed: DB init failed despite override flags", err);
  }
  
  sqliteDb.close();

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
