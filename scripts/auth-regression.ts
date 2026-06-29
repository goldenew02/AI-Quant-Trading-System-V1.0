import crypto from "crypto";

// Mock environment and DB state for testing
const mockEnv = {
  ADMIN_PASSWORD_SYNC_ON_BOOT: "false",
  BOOTSTRAP_ADMIN_PASSWORD: "secretPassword"
};

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const testHash = crypto.pbkdf2Sync(password, salt, 310000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(testHash, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function runTests() {
  console.log("Running Auth Regression Tests...");
  let passed = 0;
  let failed = 0;

  // Test 1: Verify valid password
  const testPassword = "mySecurePassword123";
  const hashed = hashPassword(testPassword);
  if (verifyPassword(testPassword, hashed)) {
    console.log("✅ Test 1 Passed: verifyPassword correctly matches valid password");
    passed++;
  } else {
    console.error("❌ Test 1 Failed: verifyPassword failed to match valid password");
    failed++;
  }

  // Test 2: Verify invalid password
  if (!verifyPassword("wrongPassword", hashed)) {
    console.log("✅ Test 2 Passed: verifyPassword correctly rejects invalid password");
    passed++;
  } else {
    console.error("❌ Test 2 Failed: verifyPassword matched an invalid password");
    failed++;
  }

  // Test 3: DB user password check logic (Simulation from auth-doctor)
  function testDoctorLogic(syncOnBoot: boolean, envPass: string, dbPassMatches: boolean) {
    let passwordMatchesBootstrap = "";
    
    if (envPass) {
      if (dbPassMatches) {
        passwordMatchesBootstrap = syncOnBoot ? "YES (Matches env password AND sync is enabled)" : "YES (Env password matches DB password)";
      } else {
        if (syncOnBoot) {
          passwordMatchesBootstrap = "NO (MISMATCH, but will be OVERWRITTEN on next boot!)";
        } else {
          passwordMatchesBootstrap = "NO (Boot sync disabled and existing credential preserved)";
        }
      }
    } else {
      passwordMatchesBootstrap = "NO (BOOTSTRAP_ADMIN_PASSWORD env variable is empty/missing)";
    }
    return passwordMatchesBootstrap;
  }

  // Test 3a: Sync disabled, password matches
  if (testDoctorLogic(false, "pass", true) === "YES (Env password matches DB password)") passed++; else failed++;
  
  // Test 3b: Sync disabled, password mismatch (Credential preserved)
  if (testDoctorLogic(false, "pass", false) === "NO (Boot sync disabled and existing credential preserved)") passed++; else failed++;
  
  // Test 3c: Sync enabled, password matches
  if (testDoctorLogic(true, "pass", true) === "YES (Matches env password AND sync is enabled)") passed++; else failed++;
  
  // Test 3d: Sync enabled, password mismatch (Will overwrite)
  if (testDoctorLogic(true, "pass", false) === "NO (MISMATCH, but will be OVERWRITTEN on next boot!)") passed++; else failed++;

  console.log(`\nTests Completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
