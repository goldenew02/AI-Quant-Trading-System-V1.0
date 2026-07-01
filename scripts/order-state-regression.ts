import { AegisDB } from "../server/db-core";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

async function run() {
  console.log("Running Order State Regression Tests...");
  let passed = 0;
  let failed = 0;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-state-test-"));
  const testEncryptionKey = crypto.randomBytes(32);
  
  let db = new AegisDB({
    dbDir: tmpDir,
    autoBootstrapEnv: false,
    seedUsers: [],
    encryptionKey: testEncryptionKey
  });
  await db.ready;
  
  // Create a mock order to test state transitions
  const createOrder = async (status: string) => {
     const id = crypto.randomUUID();
     const ord = {
        id, botId: "b1", broker: "binance", brokerAccountId: "ba1",
        clientOrderId: id, symbol: "BTCUSDT", side: "BUY", type: "MARKET",
        quantity: 1, price: 0, status, createdAt: Date.now(), updatedAt: Date.now()
     };
     await db.insertOrder(ord as any);
     return id;
  };

  const testTransition = async (name: string, from: string, to: string, shouldSucceed: boolean) => {
     const id = await createOrder(from);
     try {
        await db.updateOrderState(id, { status: to as any });
        const updated = await db.get().orders.find(o => o.clientOrderId === id);
        if (shouldSucceed) {
           if (updated?.status === to) {
              passed++; console.log(`[PASS] ${name} Passed: ${from} -> ${to} succeeded.`);
           } else {
              failed++; console.error(`[FAIL] ${name} Failed: ${from} -> ${to} did not update status.`);
           }
        } else {
           failed++; console.error(`[FAIL] ${name} Failed: ${from} -> ${to} succeeded but should have failed.`);
        }
     } catch (e: any) {
        if (shouldSucceed) {
           failed++; console.error(`[FAIL] ${name} Failed: ${from} -> ${to} threw error.`, e);
        } else {
           passed++; console.log(`[PASS] ${name} Passed: ${from} -> ${to} correctly rejected.`);
        }
     }
  };

  await testTransition("STATE-UNKNOWN-1", "WORKING", "PENDING_UNKNOWN", true);
  await testTransition("STATE-UNKNOWN-2", "NEW", "PENDING_UNKNOWN", true);
  await testTransition("STATE-UNKNOWN-3", "PARTIALLY_FILLED", "PENDING_UNKNOWN", true);
  await testTransition("STATE-UNKNOWN-4", "FILLED", "PENDING_UNKNOWN", false);
  await testTransition("STATE-UNKNOWN-5", "CANCELED", "PENDING_UNKNOWN", false);
  await testTransition("STATE-UNKNOWN-6", "REJECTED", "PENDING_UNKNOWN", false);
  await testTransition("STATE-UNKNOWN-7", "PENDING_UNKNOWN", "WORKING", true);
  await testTransition("STATE-UNKNOWN-8", "ORDER_INTENT_CREATED", "PENDING", true);

  console.log(`Order State Tests Completed: ${passed} passed, ${failed} failed.`);
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
