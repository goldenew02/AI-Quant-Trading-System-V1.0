import { AegisDB } from "../server/db-core.ts";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

async function runStrictAuditTests() {
  console.log("Running Strict Audit Regression Tests...");
  let passed = 0;
  let failed = 0;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-strict-audit-"));
  const testEncryptionKey = crypto.randomBytes(32);

  process.env.BOOTSTRAP_ADMIN_USER = "admin";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = `test-${crypto.randomBytes(16).toString("hex")}`;
  process.env.NODE_ENV = "test";

  try {
    const db = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: true,
      encryptionKey: testEncryptionKey
    });
    
    await db.ready;

    // We need to grab the sqlite db connection
    const sqliteConn = (db as any).sqliteDbConn;
    if (!sqliteConn) {
      console.log("[SKIP] Native sqlite3 unavailable; Strict Audit tests cannot run.");
      return;
    }

    const originalRun = sqliteConn.run.bind(sqliteConn);

    // Mock run
    sqliteConn.run = function(sql: string, params: any[], callback?: (err: Error | null) => void) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (sql.includes("INSERT INTO aegis_kv")) {
        const mockError = new Error("Mocked KV Write Error");
        if (callback) {
          callback(mockError);
        }
        return this;
      }
      return originalRun(sql, params, callback);
    };

    // Test STRICT-AUDIT-1: strictPersist: true should reject
    try {
      await db.appendSecurityLogAsync("system", "admin", "TEST_ACTION", "test_target", "Test details", "127.0.0.1", { strictPersist: true });
      failed++;
      console.error("[FAIL] Test STRICT-AUDIT-1 Failed: strictPersist=true resolved instead of rejecting");
    } catch (err: any) {
      if (err.message === "Mocked KV Write Error") {
        passed++;
        console.log("[PASS] Test STRICT-AUDIT-1 Passed: strictPersist=true properly rejected on DB error");
      } else {
        failed++;
        console.error("[FAIL] Test STRICT-AUDIT-1 Failed: strictPersist=true rejected with wrong error:", err);
      }
    }

    // Test STRICT-AUDIT-2: strictPersist: false should resolve
    try {
      await db.appendSecurityLogAsync("system", "admin", "TEST_ACTION_2", "test_target", "Test details 2", "127.0.0.1", { strictPersist: false });
      passed++;
      console.log("[PASS] Test STRICT-AUDIT-2 Passed: strictPersist=false properly resolved despite DB error");
    } catch (err: any) {
      failed++;
      console.error("[FAIL] Test STRICT-AUDIT-2 Failed: strictPersist=false rejected instead of resolving:", err);
    }

    // Restore original run
    sqliteConn.run = originalRun;

  } catch (err) {
    console.error("Test setup failed", err);
  }

  console.log(`Strict Audit Tests Completed: ${passed} passed, ${failed} failed.`);
  if (failed === 0) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStrictAuditTests().catch(console.error);
