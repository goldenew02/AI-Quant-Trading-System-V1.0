import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export function bootstrapAndValidateEnv() {
  const envPath = path.join(process.cwd(), ".env");
  const isProd = process.env.NODE_ENV === "production";
  const disableEnvBootstrap = process.env.NODE_ENV === "test" || process.env.AEGIS_DISABLE_ENV_BOOTSTRAP === "true";

  if (!disableEnvBootstrap && !fs.existsSync(envPath) && !isProd) {
    // Development only: dynamically bootstrap a highly secure .env with strong random secrets
    const adminUser = "admin";
    const adminPass = "Aegis_" + crypto.randomBytes(6).toString("hex") + "!";
    const encKey = crypto.randomBytes(32).toString("base64");
    const sessSec = crypto.randomBytes(32).toString("base64");

    const envContent = `# AegisQuant Secure Local Environment Configuration
BOOTSTRAP_ADMIN_USER=${adminUser}
BOOTSTRAP_ADMIN_PASSWORD=${adminPass}
ADMIN_PASSWORD_SYNC_ON_BOOT=false
ADMIN_TOTP_SYNC_ON_BOOT=false
ENCRYPTION_KEY=${encKey}
SESSION_SECRET=${sessSec}
TOTP_WINDOW_STEPS=1
NODE_ENV=development
APP_URL=http://localhost:3000
COOKIE_SAMESITE=lax
COOKIE_SECURE=false
`;
    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log("==================================================================");
    console.log("  SECURE BOOTSTRAP: Created fresh local .env with random secrets. ");
    console.log("  Administrator Account Initialized:                             ");
    console.log(`  User: ${adminUser}                                             `);
    if (process.env.ALLOW_BOOTSTRAP_PASSWORD_LOG === "true") {
      console.log(`  Password: ${adminPass}                                         `);
    } else {
      console.log("  Password generated and written to local .env. Open .env locally to retrieve it.");
    }
    console.log("  TOTP MFA Setup will be forced upon first login.                 ");
    console.log("==================================================================");
  }

  // Load environment variables (override is false, so platform Secrets take absolute precedence)
  dotenv.config({ override: false });

  // Fail-fast verification of required secrets as demanded by P0-1
  const requiredEnvVars = [
    "BOOTSTRAP_ADMIN_USER",
    "BOOTSTRAP_ADMIN_PASSWORD",
    "ENCRYPTION_KEY",
    "SESSION_SECRET"
  ];

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing critical security environment variable: ${key}`);
      process.exit(1);
    }
  }

  // Validate SESSION_SECRET size (at least 32 bytes in production, or fallback in dev)
  const SESSION_SECRET = process.env.SESSION_SECRET || "";
  if (process.env.NODE_ENV === "production" && (!SESSION_SECRET || Buffer.from(SESSION_SECRET).length < 32)) {
    console.error("FATAL: SESSION_SECRET must be at least 32 bytes long in production!");
    process.exit(1);
  }

  // Validate APP_URL is not default placeholder in production
  if (process.env.NODE_ENV === "production" && (!process.env.APP_URL || process.env.APP_URL === "MY_APP_URL" || process.env.APP_URL === "")) {
    console.error("FATAL: APP_URL must be configured and cannot be 'MY_APP_URL' in production!");
    console.error("APP_URL is still MY_APP_URL. For local testing use NODE_ENV=development and APP_URL=http://localhost:3000.");
    process.exit(1);
  }

  // Validate ENCRYPTION_KEY format (must be 32 bytes when base64 decoded)
  const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY!;
  let decodedEncryptionKey: Buffer;
  try {
    decodedEncryptionKey = Buffer.from(ENCRYPTION_KEY_RAW, "base64");
  } catch (err) {
    console.error("FATAL: ENCRYPTION_KEY must be a valid base64 encoded string.");
    process.exit(1);
  }
  if (decodedEncryptionKey.length !== 32) {
    console.error(`FATAL: ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decodedEncryptionKey.length} bytes).`);
    process.exit(1);
  }
}
