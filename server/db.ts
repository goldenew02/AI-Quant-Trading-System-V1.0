export * from "./db-core";
import { AegisDB, setEncryptionKey } from "./db-core";
import { bootstrapAndValidateEnv } from "./db-runtime";

bootstrapAndValidateEnv();

const rawKey = process.env.ENCRYPTION_KEY;
if (rawKey) {
  setEncryptionKey(Buffer.from(rawKey, "base64"));
}

export const dbInstance = new AegisDB();
