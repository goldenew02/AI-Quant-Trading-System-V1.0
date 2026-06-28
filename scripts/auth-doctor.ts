import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Load environment variables (override is false, so platform Secrets take absolute precedence)
dotenv.config({ override: false });

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

async function checkSqliteSupport(): Promise<boolean> {
  try {
    await import("sqlite3");
    return true;
  } catch {
    return false;
  }
}

async function loadDbState(sqliteSupported: boolean): Promise<any> {
  const dbDir = path.join(process.cwd(), "data");
  const sqliteFile = path.join(dbDir, "aegis_secure.db");
  const jsonFile = path.join(dbDir, "aegis_secure.json");

  // Try read-only SQLite first if supported
  if (sqliteSupported && fs.existsSync(sqliteFile)) {
    try {
      const sqlite3 = await import("sqlite3");
      const sqlite = sqlite3.default.verbose();
      return new Promise((resolve, reject) => {
        // Use read-only flag to ensure NO side-effects or table creation occurs
        const db = new sqlite.Database(sqliteFile, sqlite3.default.OPEN_READONLY, (err: any) => {
          if (err) {
            return reject(new Error(`Failed to open SQLite database in read-only mode: ${err.message}`));
          }
          db.get("SELECT value FROM aegis_kv WHERE key = 'database_state'", (selectErr: any, row: any) => {
            db.close();
            if (selectErr) {
              return reject(new Error(`Failed to query aegis_kv: ${selectErr.message}`));
            }
            if (row && row.value) {
              try {
                resolve(JSON.parse(row.value));
              } catch (parseErr: any) {
                reject(new Error(`Failed to parse SQLite state JSON: ${parseErr.message}`));
              }
            } else {
              reject(new Error("No database_state found in aegis_kv table."));
            }
          });
        });
      });
    } catch (err: any) {
      console.log(`[Read-Only Doctor] Note: Failed SQLite check, falling back to JSON check. Error: ${err.message}`);
    }
  }

  // Fallback to JSON file
  if (fs.existsSync(jsonFile)) {
    try {
      const raw = fs.readFileSync(jsonFile, "utf-8");
      return JSON.parse(raw);
    } catch (err: any) {
      throw new Error(`Failed to read or parse JSON database state file: ${err.message}`);
    }
  }

  return null;
}

async function main() {
  console.log("==================================================================");
  console.log("  AEGISQUANT SECURITY AUTHENTICATION DIAGNOSTIC UTILITY (DOCTOR)  ");
  console.log("==================================================================");

  const cwd = process.cwd();
  const envPath = path.join(cwd, ".env");
  const envExists = fs.existsSync(envPath);

  // Parse .env file directly to check for source priority (P2-1)
  const envVarsFromFile: Record<string, string> = {};
  if (envExists) {
    try {
      const envContent = fs.readFileSync(envPath, "utf-8");
      envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex !== -1) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            envVarsFromFile[key] = value;
          }
        }
      });
    } catch (e: any) {
      console.log(`[Read-Only Doctor] Failed to parse .env file: ${e.message}`);
    }
  }

  function getVarSource(key: string): string {
    const val = process.env[key];
    if (val === undefined) {
      return "NOT SET";
    }
    const fileVal = envVarsFromFile[key];
    if (fileVal !== undefined && fileVal === val) {
      return ".env contains same value as effective runtime value; actual source cannot be proven from process.env.";
    }
    if (fileVal !== undefined && fileVal !== val) {
      return "Platform / Container Environment Secret (Takes priority over different value in .env!)";
    }
    return "Platform / Container Environment Secret";
  }

  console.log(`- Current Working Directory: ${cwd}`);
  console.log(`- .env File Present: ${envExists ? "YES" : "NO"}`);
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || "not set (default: development)"} [Source: ${getVarSource("NODE_ENV")}]`);
  console.log(`- APP_URL: ${process.env.APP_URL || "not set"} [Source: ${getVarSource("APP_URL")}]`);
  console.log(`- COOKIE_SAMESITE: ${process.env.COOKIE_SAMESITE || "not set"} [Source: ${getVarSource("COOKIE_SAMESITE")}]`);
  console.log(`- COOKIE_SECURE: ${process.env.COOKIE_SECURE || "not set"} [Source: ${getVarSource("COOKIE_SECURE")}]`);
  console.log(`- BOOTSTRAP_ADMIN_USER: ${process.env.BOOTSTRAP_ADMIN_USER || "not set"} [Source: ${getVarSource("BOOTSTRAP_ADMIN_USER")}]`);
  console.log(`- BOOTSTRAP_ADMIN_PASSWORD Set: ${process.env.BOOTSTRAP_ADMIN_PASSWORD ? "YES" : "NO"} [Source: ${getVarSource("BOOTSTRAP_ADMIN_PASSWORD")}]`);
  console.log(`- ADMIN_PASSWORD_SYNC_ON_BOOT: ${process.env.ADMIN_PASSWORD_SYNC_ON_BOOT || "not set (default: true)"} [Source: ${getVarSource("ADMIN_PASSWORD_SYNC_ON_BOOT")}]`);
  console.log(`- ADMIN_TOTP_SYNC_ON_BOOT: ${process.env.ADMIN_TOTP_SYNC_ON_BOOT || "not set (default: false)"} [Source: ${getVarSource("ADMIN_TOTP_SYNC_ON_BOOT")}]`);

  const sqliteSupported = await checkSqliteSupport();
  console.log(`- Native sqlite3 Package Supported: ${sqliteSupported ? "YES" : "NO"}`);
  
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !sqliteSupported) {
    console.error("[CRITICAL] SQLite is required in production. JSON fallback is forbidden.");
    process.exit(2);
  }

  const dbBackend = isProduction || sqliteSupported ? "SQLite" : "JSON Fallback";
  console.log(`- Expected Database Backend: ${dbBackend}`);

  // Load database state in a strictly read-only manner
  const db = await loadDbState(sqliteSupported);

  console.log(`- Persistent Storage Directory: ${path.join(cwd, "data")}`);
  if (db) {
    console.log(`- Total DB Users Found: ${db.users ? db.users.length : 0}`);
  } else {
    console.log(`- DB File Loaded: NO (Database file does not exist yet; will be seeded on server startup)`);
  }

  console.log("\n--- Users Diagnostic Matrix ---");
  const warnings: string[] = [];
  const bootstrapUser = process.env.BOOTSTRAP_ADMIN_USER || "admin";
  const bootstrapPass = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";

  if (db && db.users && db.users.length > 0) {
    db.users.forEach((u: any) => {
      const isBootstrapMatch = u.username === bootstrapUser;
      let passwordMatchesBootstrap = "N/A (Not bootstrap user)";

      if (isBootstrapMatch) {
        if (bootstrapPass) {
          const matched = verifyPassword(bootstrapPass, u.passwordHash);
          passwordMatchesBootstrap = matched ? "YES (Matches current env password)" : "NO (MISMATCH with current env password!)";
          if (!matched) {
            warnings.push(`[CRITICAL] Username matches bootstrap admin ('${bootstrapUser}'), but actual database password hash does NOT match BOOTSTRAP_ADMIN_PASSWORD from env! Login with the env password will fail.`);
          }
        } else {
          passwordMatchesBootstrap = "NO (BOOTSTRAP_ADMIN_PASSWORD env variable is empty/missing)";
          warnings.push(`[CRITICAL] BOOTSTRAP_ADMIN_PASSWORD is not set or empty in environment!`);
        }
      }

      console.log(`- Username: ${u.username}`);
      console.log(`  Role: ${u.role}`);
      console.log(`  Active: ${u.isActive ? "YES" : "NO"}`);
      console.log(`  Must Enroll TOTP: ${u.mustEnrollTotp ? "YES" : "NO"}`);
      console.log(`  TOTP Configured: ${u.totpSecret ? "YES" : "NO"}`);
      console.log(`  Password Align with Env: ${passwordMatchesBootstrap}`);
    });
  } else if (db) {
    warnings.push("[CRITICAL] No users found in database! The system has zero accounts.");
  }

  // SameSite=none checking
  const configuredSameSite = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  const appUrlVal = process.env.APP_URL || "";
  const isHttps = appUrlVal.startsWith("https://");
  if (configuredSameSite === "none" && !isHttps) {
    warnings.push("[WARNING] COOKIE_SAMESITE=none is configured, but APP_URL is not HTTPS. Secure cookies require secure HTTPS to be successfully saved by browsers inside iFrames.");
  }

  // Count administrators
  if (db && db.users) {
    const adminUsers = db.users.filter((u: any) => u.role === "admin" && u.isActive);
    if (adminUsers.length > 1) {
      warnings.push(`[WARNING] Multiple active administrators found in DB (${adminUsers.map((u: any) => u.username).join(", ")}). Ensure this is intended.`);
    }
  }

  // JSON fallback production warning
  if (isProduction && !sqliteSupported) {
    warnings.push("[CRITICAL] SQLite fallback was expected to fail in production, but if running with mock/override environments, ensure JSON storage is NOT used for live trading.");
  }

  console.log("\n--- Warnings & Security Risks ---");
  if (warnings.length > 0) {
    warnings.forEach((w) => console.log(` ${w}`));
  } else {
    console.log("  No diagnostic warnings detected. All system config checks are green!");
  }
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("[FATAL ERROR] Diagnostic utility failed:", err);
  process.exit(1);
});
