import dotenv from "dotenv";
dotenv.config({ override: false }); // Load env variables, but do not override platform/container secrets

import { dbInstance, hashPassword } from "../server/db";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const usernameIndex = args.indexOf("--username");
  
  // Default to BOOTSTRAP_ADMIN_USER or "admin" if username arg is not explicitly provided
  const targetUsername = usernameIndex !== -1 && args[usernameIndex + 1] 
    ? args[usernameIndex + 1] 
    : (process.env.BOOTSTRAP_ADMIN_USER || "admin");

  const bootstrapPass = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";

  if (!bootstrapPass || bootstrapPass === "replace-with-strong-random-password") {
    console.error("==================================================================");
    console.error("  CRITICAL ERROR: No valid BOOTSTRAP_ADMIN_PASSWORD was found.");
    console.error("  Please configure a strong password in your environment or .env file.");
    console.error("  Do not use the default template placeholder value.");
    console.error("==================================================================");
    process.exit(1);
  }

  if (!confirm) {
    console.error("==================================================================");
    console.error("  CRITICAL ERROR: Confirmation flag '--confirm' is missing.");
    console.error(`  To sync and update password for user '${targetUsername}', execute:`);
    console.error(`  npm run sync-admin-password -- --username ${targetUsername} --confirm`);
    console.error("==================================================================");
    process.exit(1);
  }

  console.log(`[CLI] Initializing administrator password synchronization for user: ${targetUsername}...`);

  // Wait for DB to be initialized
  await dbInstance.ready;

  const db = dbInstance.get();
  const user = db.users.find((u: any) => u.username === targetUsername);
  
  if (!user) {
    console.error(`[CLI ERROR] User '${targetUsername}' was not found in the persistent database.`);
    process.exit(1);
  }

  // Update password hash
  user.passwordHash = hashPassword(bootstrapPass);

  // Clear all sessions for this user to enforce logout/invalidation
  const originalSessionCount = db.sessions.length;
  db.sessions = db.sessions.filter((s: any) => s.username !== targetUsername);
  const invalidatedSessionCount = originalSessionCount - db.sessions.length;

  // Append security audit log entry
  dbInstance.appendSecurityLog(
    "cli_admin",
    "admin",
    "ADMIN_PASSWORD_RESET_CLI",
    targetUsername,
    `Admin password was updated and synced via CLI tool trigger. Invalidated ${invalidatedSessionCount} active session(s).`
  );

  dbInstance.save();

  console.log(`==================================================================`);
  console.log(`[SUCCESS] Admin password synchronized successfully!`);
  console.log(`- Username: ${targetUsername}`);
  console.log(`- Password Hash: Updated to match BOOTSTRAP_ADMIN_PASSWORD`);
  console.log(`- Invalidated Sessions: ${invalidatedSessionCount} session(s) cleared`);
  console.log(`- Audit Log: Recorded secure entry under ADMIN_PASSWORD_RESET_CLI.`);
  console.log(`==================================================================`);
}

main().catch(err => {
  console.error("[CLI FATAL ERROR] Failed to sync admin password:", err);
  process.exit(1);
});
