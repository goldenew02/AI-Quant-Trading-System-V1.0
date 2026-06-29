export * from "./db-core";
import { AegisDB } from "./db-core";
import { bootstrapAndValidateEnv } from "./db-runtime";

bootstrapAndValidateEnv();

export const dbInstance = new AegisDB();
