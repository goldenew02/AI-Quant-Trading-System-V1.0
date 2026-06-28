import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config({ override: false }); // Load env variables, but do not override platform/container secrets

import { dbInstance, verifyPassword } from "../server/db";

async function checkSqliteSupport(): Promise<boolean> {
  try {
    await import("sqlite3");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("==================================================================");
  console.log("  AEGISQUANT SECURITY AUTHENTICATION DIAGNOSTIC UTILITY (DOCTOR)  ");
  console.log("==================================================================");

  const cwd = process.cwd();
  const envPath = path.join(cwd, ".env");
  const envExists = fs.existsSync(envPath);

  console.log(`- Current Working Directory: ${cwd}`);
  console.log(`- .env File Present: ${envExists ? "YES" : "NO"}`);
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || "not set (default: development)"}`);
  console.log(`- APP_URL: ${process.env.APP_URL || "not set"}`);
  console.log(`- COOKIE_SAMESITE: ${process.env.COOKIE_SAMESITE || "not set (default: lax)"}`);
  console.log(`- COOKIE_SECURE: ${process.env.COOKIE_SECURE || "not set"}`);
  console.log(`- BOOTSTRAP_ADMIN_USER: ${process.env.BOOTSTRAP_ADMIN_USER || "not set"}`);
  console.log(`- BOOTSTRAP_ADMIN_PASSWORD Set: ${process.env.BOOTSTRAP_ADMIN_PASSWORD ? "YES" : "NO"}`);
  console.log(`- ADMIN_PASSWORD_SYNC_ON_BOOT: ${process.env.ADMIN_PASSWORD_SYNC_ON_BOOT || "not set (default: true)"}`);
  console.log(`- ADMIN_TOTP_SYNC_ON_BOOT: ${process.env.ADMIN_TOTP_SYNC_ON_BOOT || "not set (default: false)"}`);

  const sqliteSupported = await checkSqliteSupport();
  console.log(`- Native sqlite3 Package Supported: ${sqliteSupported ? "YES" : "NO"}`);
  
  const isProduction = process.env.NODE_ENV === "production";
  const dbBackend = isProduction || sqliteSupported ? "SQLite" : "JSON Fallback";
  console.log(`- Expected Database Backend: ${dbBackend}`);

  // Wait for dbInstance to be ready and initialized
  await dbInstance.ready;
  const db = dbInstance.get();

  console.log(`- Persistent Storage Directory: ${path.join(cwd, "data")}`);
  console.log(`- Total DB Users Found: ${db.users ? db.users.length : 0}`);

  console.log("\n--- Users Diagnostic Matrix ---");
  const warnings: string[] = [];
  const bootstrapUser = process.env.BOOTSTRAP_ADMIN_USER || "admin";
  const bootstrapPass = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";

  if (db.users && db.users.length > 0) {
    db.users.forEach((u: any) => {
      const isBootstrapMatch = u.username === bootstrapUser;
      let passwordMatchesBootstrap = "N/A (Not bootstrap user)";

      if (isBootstrapMatch) {
        if (bootstrapPass) {
          const matched = verifyPassword(bootstrapPass, u.passwordHash);
          passwordMatchesBootstrap = matched ? "YES (Matches env password)" : "NO (MISMATCH with env password!)";
          if (!matched) {
            warnings.push(`[CRITICAL] Username matches bootstrap admin ('${bootstrapUser}'), but actual database password hash does NOT match BOOTSTRAP_ADMIN_PASSWORD from env! Login with the env password will fail.`);
          }
        } else {
          passwordMatchesBootstrap = "NO (BOOTSTRAP_ADMIN_PASSWORD env variable is empty)";
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
  } else {
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
  const adminUsers = db.users ? db.users.filter((u: any) => u.role === "admin" && u.isActive) : [];
  if (adminUsers.length > 1) {
    warnings.push(`[WARNING] Multiple active administrators found in DB (${adminUsers.map((u: any) => u.username).join(", ")}). Ensure this is intended.`);
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
