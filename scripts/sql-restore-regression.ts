import { AegisDB } from "../server/db-core.ts";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

function hashDirectory(dirPath: string): string {
  if (!fs.existsSync(dirPath)) return "NONE";
  const files = fs.readdirSync(dirPath).sort();
  const hashes = files.map(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      return hashDirectory(fullPath);
    }
    return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
  });
  return crypto.createHash("sha256").update(hashes.join("|")).digest("hex");
}

async function run() {
  console.log("Running SQL Restore Regression Tests...");

  const dataDir = path.join(process.cwd(), "data");
  const envPath = path.join(process.cwd(), ".env");
  const initialDataHash = hashDirectory(dataDir);
  const initialEnvHash = fs.existsSync(envPath) ? crypto.createHash("sha256").update(fs.readFileSync(envPath)).digest("hex") : "NONE";

  // Setup temporary dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-sql-restore-"));
  const testEncryptionKey = crypto.randomBytes(32);
  
  let db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: false,
    seedUsers: [],
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  if (!(db as any).sqliteDbConn) {
    console.log("Native sqlite3 package is not active; skipping SQL tests.");
    process.exit(0);
  }

  // Test SQL-RESTORE-2: Seed and then write orders/fills. Then drop KV and see if they come back.
  
  const testOrder = {
    id: "ord-sql-rest-1",
    botId: "bot-1",
    broker: "Binance" as const,
    brokerAccountId: "acc-1",
    clientOrderId: "CLIENT_ORD_1",
    symbol: "BTC/USDT",
    marketType: "spot" as const,
    side: "BUY" as const,
    type: "LMT" as const,
    price: 50000,
    quantity: 1,
    status: "PENDING_UNKNOWN" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manualReviewRequired: true,
    lastBrokerStatus: "PLACE_ORDER_TIMEOUT",
    cancelRetryCount: 2
  };
  
  const testFill = {
    id: "fill-sql-rest-1",
    orderId: testOrder.id,
    brokerFillId: "BROKER_FILL_1",
    price: 50000,
    quantity: 0.5,
    fee: 0.1,
    feeCurrency: "USDT",
    timestamp: new Date().toISOString()
  };

  await db.insertOrder(testOrder);
  await db.insertFill(testFill);
  
  // Verify inserted in memory
  const dbData1 = db.get();
  if (dbData1.orders.find((o: any) => o.id === testOrder.id)) {
    console.log("[PASS] Test 0 Passed: Inserted test order to memory");
  } else {
    console.error("[FAIL] Test 0 Failed: Order not in memory");
  }

  // Corrupt KV store (drop database_state)
  await new Promise<void>((resolve, reject) => {
    (db as any).sqliteDbConn.run("DELETE FROM aegis_kv WHERE key = 'database_state'", (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Re-init AegisDB
  db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: false,
    seedUsers: [],
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  
  const dbData2 = db.get();
  const restoredOrder = dbData2.orders.find((o: any) => o.id === testOrder.id);
  const restoredFill = dbData2.fills.find((f: any) => f.id === testFill.id);

  if (restoredOrder && restoredOrder.manualReviewRequired === true && restoredOrder.cancelRetryCount === 2) {
    console.log("[PASS] Test SQL-RESTORE-2 Passed: KV missing, but structured orders restored successfully");
  } else {
    console.error("[FAIL] Test SQL-RESTORE-2 Failed: Order not restored properly", restoredOrder);
  }

  if (restoredFill && restoredFill.price === 50000) {
    console.log("[PASS] Test SQL-RESTORE-2 (Fills) Passed: KV missing, but structured fills restored successfully");
  } else {
    console.error("[FAIL] Test SQL-RESTORE-2 (Fills) Failed: Fill not restored properly", restoredFill);
  }
  
  // Test SQL-RESTORE-1: Update order, let it save to KV, see if structured overrides KV on load
  await db.updateOrderState(testOrder.clientOrderId, { status: "WORKING", manualReviewRequired: false });
  // Manually corrupt the order in KV only
  const kvData = JSON.parse(JSON.stringify(db.get()));
  const kvOrder = kvData.orders.find((o: any) => o.clientOrderId === testOrder.clientOrderId);
  kvOrder.status = "REJECTED"; // This shouldn't be what we load, since structured is WORKING
  kvOrder.manualReviewRequired = true; // Structured should be false
  
  await new Promise<void>((resolve, reject) => {
    (db as any).sqliteDbConn.run(
      "UPDATE aegis_kv SET value = ? WHERE key = 'database_state'",
      [JSON.stringify(kvData)],
      (err: any) => err ? reject(err) : resolve()
    );
  });

  db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: false,
    seedUsers: [],
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  
  const dbData3 = db.get();
  const restoredOrder2 = dbData3.orders.find((o: any) => o.id === testOrder.id);

  if (restoredOrder2 && restoredOrder2.status === "WORKING" && restoredOrder2.manualReviewRequired === false) {
    console.log("[PASS] Test SQL-RESTORE-1 Passed: Structured orders correctly override KV on load");
  } else {
    console.error("[FAIL] Test SQL-RESTORE-1 Failed: KV data was favored over structured", restoredOrder2);
  }

  // Test SQL-RESTORE-3: Corrupted schema should fail-fast in production
  await new Promise<void>((resolve, reject) => {
    (db as any).sqliteDbConn.run("DROP TABLE orders", (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

  process.env.NODE_ENV = "production";
  try {
    const dbFail = new AegisDB({
      dbDir: tmpDir,
      autoBootstrapEnv: false,
      seedUsers: [],
      encryptionKey: testEncryptionKey
    });
    await dbFail.ready;
    console.error("[FAIL] Test SQL-RESTORE-3 Failed: DB init succeeded despite missing orders table in production");
  } catch (err: any) {
    if (err.message && err.message.includes("no such table: orders")) {
      console.log("[PASS] Test SQL-RESTORE-3 Passed: Missing structured table failed-fast in production");
    } else {
      console.error("[FAIL] Test SQL-RESTORE-3 Failed: Incorrect error thrown", err);
    }
  }
  process.env.NODE_ENV = "development";

  // Test SQL-ISOLATION-1
  const finalDataHash = hashDirectory(dataDir);
  const finalEnvHash = fs.existsSync(envPath) ? crypto.createHash("sha256").update(fs.readFileSync(envPath)).digest("hex") : "NONE";

  if (finalDataHash === initialDataHash) {
    console.log("[PASS] Test SQL-ISOLATION-1 Passed: Root data/ directory unchanged");
  } else {
    console.error("[FAIL] Test SQL-ISOLATION-1 Failed: Root data/ directory was modified!");
  }

  if (finalEnvHash === initialEnvHash) {
    console.log("[PASS] Test SQL-ISOLATION-1 Passed: Root .env unchanged");
  } else {
    console.error("[FAIL] Test SQL-ISOLATION-1 Failed: Root .env was modified!");
  }

  console.log("SQL Restore Regression Tests Completed.");
  process.exit(0);
}

run().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
