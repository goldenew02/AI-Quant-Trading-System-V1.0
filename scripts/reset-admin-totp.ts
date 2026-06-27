import dotenv from "dotenv";
dotenv.config({ override: true }); // Ensure we load env

import { dbInstance } from "../server/db";

async function main() {
  // Wait for DB to be initialized
  await dbInstance.ready;

  const username = process.env.BOOTSTRAP_ADMIN_USER || "admin";
  const user = dbInstance.get().users.find((u: any) => u.username === username);
  if (!user) {
    console.error(`Error: User '${username}' not found in database.`);
    process.exit(1);
  }

  user.totpSecret = null;
  user.mustEnrollTotp = true;
  if (user.tempTotpSecret) delete user.tempTotpSecret;
  if (user.tempTotpExpiresAt) delete user.tempTotpExpiresAt;

  dbInstance.save();
  console.log(`==================================================================`);
  console.log(`[SUCCESS] Admin TOTP reset completed successfully!`);
  console.log(`- Username: ${username}`);
  console.log(`- Action: Cleared 'totpSecret' and set 'mustEnrollTotp' to true.`);
  console.log(`- Next step: Log in and configure your Google Authenticator on next login.`);
  console.log(`==================================================================`);
}

main().catch(err => {
  console.error("Failed to reset admin TOTP:", err);
  process.exit(1);
});
