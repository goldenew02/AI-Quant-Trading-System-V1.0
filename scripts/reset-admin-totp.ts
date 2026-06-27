import dotenv from "dotenv";
dotenv.config({ override: false }); // Ensure we load env but do not override platform/container secrets

import { dbInstance } from "../server/db";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const usernameIndex = args.indexOf("--username");
  
  // Default to BOOTSTRAP_ADMIN_USER or "admin" if username arg is not explicitly provided
  const targetUsername = usernameIndex !== -1 && args[usernameIndex + 1] 
    ? args[usernameIndex + 1] 
    : (process.env.BOOTSTRAP_ADMIN_USER || "admin");

  if (!confirm) {
    console.error("==================================================================");
    console.error("  CRITICAL ERROR: Confirmation flag '--confirm' is missing.");
    console.error(`  To reset MFA/TOTP for user '${targetUsername}', please execute:`);
    console.error(`  npm run reset-admin-totp -- --username ${targetUsername} --confirm`);
    console.error("==================================================================");
    process.exit(1);
  }

  console.log(`[CLI] Initializing secure TOTP reset workflow for user: ${targetUsername}...`);

  // Wait for DB to be initialized
  await dbInstance.ready;

  const user = dbInstance.get().users.find((u: any) => u.username === targetUsername);
  if (!user) {
    console.error(`[CLI ERROR] User '${targetUsername}' was not found in the persistent database.`);
    process.exit(1);
  }

  // Clear TOTP secrets and force enrollment
  user.totpSecret = null;
  user.mustEnrollTotp = true;
  if (user.tempTotpSecret) delete user.tempTotpSecret;
  if (user.tempTotpExpiresAt) delete user.tempTotpExpiresAt;

  // Append security audit log entry
  dbInstance.appendSecurityLog(
    "cli_admin",
    "admin",
    "ADMIN_TOTP_RESET_CLI",
    targetUsername,
    `Admin TOTP security factor was cleared and reset to forced enrollment via cli trigger. Target username: ${targetUsername}`
  );

  dbInstance.save();

  console.log(`==================================================================`);
  console.log(`[SUCCESS] Admin TOTP reset completed successfully!`);
  console.log(`- Username: ${targetUsername}`);
  console.log(`- Action: Cleared 'totpSecret' and set 'mustEnrollTotp' to true.`);
  console.log(`- Audit Log: Recorded secure entry under ADMIN_TOTP_RESET_CLI.`);
  console.log(`- Next step: Log in and configure your authenticator device on next login.`);
  console.log(`==================================================================`);
}

main().catch(err => {
  console.error("[CLI FATAL ERROR] Failed to reset admin TOTP:", err);
  process.exit(1);
});
