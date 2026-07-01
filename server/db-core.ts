import crypto from "crypto";
import fs from "fs";
import path from "path";
import { BotConfig, TradeLog, RiskSettings, BrokerAccount, Order, Fill } from "../src/types";

// --- DYNAMIC SQLITE DETECTION & FALLBACK SETUP ---
let sqlite3: any = null;
let isSqliteSupported: boolean | null = null;

async function checkSqliteSupport(): Promise<boolean> {
  if (isSqliteSupported !== null) return isSqliteSupported;
  try {
    const sqliteModule = await import("sqlite3");
    sqlite3 = sqliteModule.default || sqliteModule;
    isSqliteSupported = true;
  } catch (err: any) {
    console.log("[Aegis DB] Native sqlite3 package is not active; selecting JSON storage fallback.");
    isSqliteSupported = false;
  }
  return isSqliteSupported;
}

export interface DBUser {
  username: string;
  passwordHash: string;
  role: 'admin' | 'operator' | 'viewer';
  totpSecret: string | null; // standard base32 secret (AES-GCM encrypted)
  isActive: boolean;
  tempTotpSecret?: string | null;
  tempTotpExpiresAt?: number | null;
  mustEnrollTotp?: boolean;
  passwordVersion?: number;
}

export interface DBSession {
  tokenHash: string; // sha256(token + SESSION_SECRET) to protect token leakage in db
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  expiresAt: number;
  purpose?: 'enrollment' | 'full';
  passwordVersionAtLogin?: number;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  action: string;
  target: string;
  details: string;
  ipAddress: string;
  previousHash: string;
  currentHash: string;
}

export interface AegisDatabase {
  users: DBUser[];
  sessions: DBSession[];
  bots: BotConfig[];
  tradeLogs: TradeLog[];
  securityAuditLogs: SecurityAuditEntry[];
  riskSettings: RiskSettings;
  ibConnectionMode: 'gateway' | 'web_api_proxy';
  brokerAccounts: BrokerAccount[];
  orders: Order[];
  fills: Fill[];
  mfaActionTokens?: {
    tokenHash: string;
    sessionIdHash: string;
    username: string;
    action: string;
    bodyHash: string;
    expiresAt: number;
    usedAt?: number | null;
  }[];
  preauthSessions?: {
    preauthIdHash: string;
    username: string;
    role: 'admin' | 'operator' | 'viewer';
    expiresAt: number;
    failures?: number;
  }[];
}



// Dynamic base32 decoder for standard Google Authenticator TOTP keys
function base32ToBuffer(secret: string): Buffer {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanSecret = secret.toUpperCase().replace(/[\s-]/g, "");
  let bits = "";
  for (let i = 0; i < cleanSecret.length; i++) {
    const val = base32chars.indexOf(cleanSecret[i]);
    if (val >= 0) {
      bits += val.toString(2).padStart(5, "0");
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// RFC 6238 Standard TOTP Verifier
export function verifyTOTP(secret: string, token: string): boolean {
  const cleanToken = token.trim();
  if (cleanToken.length !== 6 || isNaN(Number(cleanToken))) {
    return false;
  }

  let key: Buffer;
  try {
    key = base32ToBuffer(secret);
  } catch (e) {
    key = Buffer.from(secret, "ascii");
  }

  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30);

  const windowSize = Number(process.env.TOTP_WINDOW_STEPS || "1");
  const safeWindow = Math.min(Math.max(windowSize, 0), 2);
  // Buffer check window for standard clock drifts (configured via TOTP_WINDOW_STEPS, default +/- 1 step of 30 seconds)
  for (let drift = -safeWindow; drift <= safeWindow; drift++) {
    const step = timeStep + drift;
    const msg = Buffer.alloc(8);
    
    let high = 0;
    let low = step;
    if (step > 0xffffffff) {
      high = Math.floor(step / 0x100000000);
      low = step % 0x100000000;
    }
    msg.writeUInt32BE(high, 0);
    msg.writeUInt32BE(low, 4);

    const hmac = crypto.createHmac("sha1", key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const codeVal =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const otp = (codeVal % 1000000).toString().padStart(6, "0");
    if (otp === cleanToken) {
      return true;
    }
  }
  return false;
}

// PBKDF2 Password Hashing (310,000 iterations + SHA-512)
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, originalHash] = stored.split(":");
    const hash = crypto.pbkdf2Sync(password, salt, 310000, 64, "sha512").toString("hex");
    const hashBuffer = Buffer.from(hash, "hex");
    const originalBuffer = Buffer.from(originalHash, "hex");
    return crypto.timingSafeEqual(hashBuffer, originalBuffer);
  } catch (e) {
    return false;
  }
}

let _encryptionKey: Buffer | null = null;

export function setEncryptionKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Encryption key must be exactly 32 bytes");
  _encryptionKey = key;
}

function getDecodedEncryptionKey(): Buffer {
  if (!_encryptionKey) {
    throw new Error("CRITICAL: Encryption key not set. Call setEncryptionKey() first.");
  }
  return _encryptionKey;
}

// AES-256-GCM Secure Encryption complying with P0-3
// Format: v1:k1:iv:ciphertext:authTag (No fallbacks or silent plaintext degradation)
export function encryptSecret(plainText: string): string {
  try {
    const iv = crypto.randomBytes(12);
    // Use decoded 32-byte encryption key
    const cipher = crypto.createCipheriv("aes-256-gcm", getDecodedEncryptionKey(), iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `v1:k1:${iv.toString("hex")}:${encrypted}:${authTag}`;
  } catch (err: any) {
    console.error("Encryption failure:", err);
    throw new Error(`CRITICAL_DECRYPTION_EXCEPTION: Cryptographic encryption failed - ${err.message}`);
  }
}

export function decryptSecret(encryptedText: string): string {
  try {
    if (!encryptedText.startsWith("v1:k1:")) {
      throw new Error("Invalid cipher format (no matching version header)");
    }
    const parts = encryptedText.split(":");
    if (parts.length !== 5) {
      throw new Error("Malformed cipher metadata blocks.");
    }
    const [, , ivHex, encryptedHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", getDecodedEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err: any) {
    console.error("Decryption failure:", err);
    throw new Error(`CRITICAL_DECRYPTION_EXCEPTION: Cryptographic decryption failed - ${err.message}`);
  }
}

// Cryptographic hash calculations for log audits
export function computeLogHash(log: TradeLog, prevHash: string): string {
  const content = `${log.id}-${log.timestamp}-${log.type}-${log.price}-${log.amount}-${log.total}-${prevHash}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeSecurityHash(log: SecurityAuditEntry, prevHash: string): string {
  const content = `${log.id}|${log.timestamp}|${log.username}|${log.role}|${log.action}|${log.target}|${log.details}|${log.ipAddress}|${prevHash}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class AegisDB {
  private data: AegisDatabase = {
    users: [],
    sessions: [],
    bots: [],
    tradeLogs: [],
    securityAuditLogs: [],
    riskSettings: {
      maxDailyDrawdown: 8.0,
      maxAccountDrawdown: 15.0,
      globalKillSwitch: false,
      maxLeverageLimit: 10,
      dailyLossLimitUSD: 800,
      restrictedSymbols: ["SHIB/USDT", "DOGE/USDT"],
      singleAssetMaxAllocationPercent: 40,
      industryCryptoMaxPercent: 60,
      autoMeltDrawdownThreshold: 12.0,
      autoMeltSharpeThreshold: 0.8
    },
    ibConnectionMode: "web_api_proxy",
    brokerAccounts: [],
    orders: [],
    fills: [],
    mfaActionTokens: [],
    preauthSessions: []
  };
  private sqliteDbConn: any = null;
  public ready: Promise<void>;
  private dbDir: string;
  private autoBootstrapEnv: boolean;

  private seedUsers: any[] | undefined;

  constructor(options?: { dbDir?: string; autoBootstrapEnv?: boolean; seedUsers?: any[]; encryptionKey?: Buffer }) {
    if (options?.encryptionKey) {
      setEncryptionKey(options.encryptionKey);
    }
    this.dbDir = options?.dbDir || path.join(process.cwd(), "data");
    this.autoBootstrapEnv = options?.autoBootstrapEnv ?? true;
    this.seedUsers = options?.seedUsers;
    this.ready = this.initDatabaseAsync();
  }

  private updateDataInPlace(source: any) {
    if (!source) return;
    
    // In-place update of arrays so references are perfectly preserved
    const updateArrayInPlace = (key: string) => {
      const targetArr = (this.data as any)[key] || [];
      const sourceArr = source[key] || [];
      targetArr.splice(0, targetArr.length, ...sourceArr);
      (this.data as any)[key] = targetArr;
    };

    updateArrayInPlace("users");
    updateArrayInPlace("sessions");
    updateArrayInPlace("bots");
    updateArrayInPlace("tradeLogs");
    updateArrayInPlace("securityAuditLogs");
    updateArrayInPlace("brokerAccounts");
    updateArrayInPlace("orders");
    updateArrayInPlace("fills");
    updateArrayInPlace("mfaActionTokens");
    updateArrayInPlace("preauthSessions");

    // In-place update of riskSettings
    if (source.riskSettings) {
      for (const key of Object.keys(this.data.riskSettings)) {
        delete (this.data.riskSettings as any)[key];
      }
      Object.assign(this.data.riskSettings, source.riskSettings);
    }

    if (source.ibConnectionMode) {
      this.data.ibConnectionMode = source.ibConnectionMode;
    }

    this.ensureDataDefaults();
  }

  private ensureDataDefaults() {
    if (!this.data.users) this.data.users = [];
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.bots) this.data.bots = [];
    if (!this.data.tradeLogs) this.data.tradeLogs = [];
    if (!this.data.securityAuditLogs) this.data.securityAuditLogs = [];
    if (!this.data.brokerAccounts) this.data.brokerAccounts = [];
    if (!this.data.orders) this.data.orders = [];
    if (!this.data.fills) this.data.fills = [];
    
    // Migration: add marketType to existing orders
    for (const order of this.data.orders) {
      if (!order.marketType) {
        const bot = this.data.bots?.find((b: any) => b.id === order.botId);
        order.marketType = (bot?.gridType === "perpetual" || bot?.type === "futures_grid") ? "perpetual" : "spot";
      }
    }

    if (!this.data.mfaActionTokens) this.data.mfaActionTokens = [];
    if (!this.data.preauthSessions) this.data.preauthSessions = [];
    if (!this.data.riskSettings) {
      this.data.riskSettings = {
        maxDailyDrawdown: 8.0,
        maxAccountDrawdown: 15.0,
        globalKillSwitch: false,
        maxLeverageLimit: 10,
        dailyLossLimitUSD: 800,
        restrictedSymbols: ["SHIB/USDT", "DOGE/USDT"],
        singleAssetMaxAllocationPercent: 40,
        industryCryptoMaxPercent: 60,
        autoMeltDrawdownThreshold: 12.0,
        autoMeltSharpeThreshold: 0.8
      };
    }
    if (!this.data.ibConnectionMode) this.data.ibConnectionMode = "web_api_proxy";

    if (this.autoBootstrapEnv) {
      // Synchronize admin password and TOTP secret with process.env to prevent out-of-sync credential lockouts
      const seedUser = process.env.BOOTSTRAP_ADMIN_USER;
      const seedPass = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      const seedTotp = process.env.BOOTSTRAP_ADMIN_TOTP_SECRET;

      // Safety switches for synchronizing credentials on boot
      const syncPasswordOnBoot = process.env.ADMIN_PASSWORD_SYNC_ON_BOOT === "true"; // defaults to false for protection against unintentional overwrite
      const syncTotpOnBoot = process.env.ADMIN_TOTP_SYNC_ON_BOOT === "true"; // defaults to false for protection against unintentional overwrite

      if (seedUser && seedPass) {
        let adminUser = this.data.users.find(u => u.username === seedUser);
        let needsSave = false;
        if (!adminUser) {
          adminUser = {
            username: seedUser,
            passwordHash: hashPassword(seedPass),
            role: "admin",
            totpSecret: (seedTotp && syncTotpOnBoot) ? encryptSecret(seedTotp) : null,
            isActive: true,
            mustEnrollTotp: (seedTotp && syncTotpOnBoot) ? false : true
          };
          this.data.users.push(adminUser);
          needsSave = true;
          this.appendSecurityLog(
            "system",
            "admin",
            "ADMIN_BOOTSTRAP_CREATE",
            seedUser,
            "Administrator account initialized from environment config during system boot."
          );
        } else {
          if (syncPasswordOnBoot && !verifyPassword(seedPass, adminUser.passwordHash)) {
            adminUser.passwordHash = hashPassword(seedPass);
            adminUser.passwordVersion = (adminUser.passwordVersion || 1) + 1;
            needsSave = true;
            this.appendSecurityLog(
              "system",
              "admin",
              "ADMIN_PASSWORD_ENV_SYNC",
              seedUser,
              "Administrator password synchronized from environment config during system boot."
            );
          }
          if (seedTotp && syncTotpOnBoot) {
            let currentTotp: string | null = null;
            if (adminUser.totpSecret) {
              try {
                currentTotp = decryptSecret(adminUser.totpSecret);
              } catch (e) {
                // Decryption fail, overwrite below
              }
            }
            if (currentTotp !== seedTotp || adminUser.mustEnrollTotp) {
              adminUser.totpSecret = encryptSecret(seedTotp);
              adminUser.mustEnrollTotp = false;
              needsSave = true;
              this.appendSecurityLog(
                "system",
                "admin",
                "ADMIN_TOTP_ENV_SYNC",
                seedUser,
                "Administrator TOTP secret synchronized from environment config during system boot."
              );
            }
          }
        }
        if (needsSave) {
          this.save();
        }
      }
    }
  }

  private async seedAndSave(sqliteDb: any): Promise<void> {
    return new Promise<void>((res, rej) => {
      try {
        let initialUsers: any[] = [];
        if (this.seedUsers) {
          initialUsers = this.seedUsers;
        } else if (this.autoBootstrapEnv) {
          const seedUser = process.env.BOOTSTRAP_ADMIN_USER;
          const seedPass = process.env.BOOTSTRAP_ADMIN_PASSWORD;
          if (seedUser && seedPass) {
            initialUsers = [
              {
                username: seedUser,
                passwordHash: hashPassword(seedPass),
                role: "admin",
                totpSecret: null,
                isActive: true,
                mustEnrollTotp: true
              }
            ];
          }
        }

        const seedData = {
          users: initialUsers,
          sessions: [],
          bots: this.getSeedBots(),
          tradeLogs: this.getSeedTradeLogs(),
          securityAuditLogs: this.getSeedSecurityLogs(),
          riskSettings: {
            maxDailyDrawdown: 8.0,
            maxAccountDrawdown: 15.0,
            globalKillSwitch: false,
            maxLeverageLimit: 10,
            dailyLossLimitUSD: 800,
            restrictedSymbols: ["SHIB/USDT", "DOGE/USDT"],
            singleAssetMaxAllocationPercent: 40,
            industryCryptoMaxPercent: 60,
            autoMeltDrawdownThreshold: 12.0,
            autoMeltSharpeThreshold: 0.8
          },
          ibConnectionMode: "web_api_proxy" as any,
          brokerAccounts: [],
          orders: [],
          fills: [],
          mfaActionTokens: [],
          preauthSessions: []
        };
        this.updateDataInPlace(seedData);

        sqliteDb.run(
          "INSERT INTO aegis_kv (key, value) VALUES ('database_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [JSON.stringify(this.data, null, 2)],
          (err: any) => {
            if (err) {
              console.error("Failed to seed database in SQLite:", err);
              return rej(err);
            }
            res();
          }
        );
      } catch (err) {
        rej(err);
      }
    });
  }

  private async initDatabaseAsync(): Promise<void> {
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    const sqliteSupported = await checkSqliteSupport();
    if (process.env.NODE_ENV === "production" && !sqliteSupported) {
      throw new Error("SQLite is required in production; JSON fallback is forbidden.");
    }

    if (!sqliteSupported) {
      const JSON_FILE = path.join(this.dbDir, "aegis_secure.json");
      if (fs.existsSync(JSON_FILE)) {
        try {
          const raw = fs.readFileSync(JSON_FILE, "utf-8");
          this.updateDataInPlace(JSON.parse(raw));
          return;
        } catch (err) {
          console.error("Failed to parse JSON state, fallback to seed:", err);
        }
      }
      
      let initialUsers: any[] = [];
      if (this.seedUsers) {
        initialUsers = this.seedUsers;
      } else if (this.autoBootstrapEnv) {
        const seedUser = process.env.BOOTSTRAP_ADMIN_USER;
        const seedPass = process.env.BOOTSTRAP_ADMIN_PASSWORD;
        if (seedUser && seedPass) {
          initialUsers = [
            {
              username: seedUser,
              passwordHash: hashPassword(seedPass),
              role: "admin",
              totpSecret: null,
              isActive: true,
              mustEnrollTotp: true
            }
          ];
        }
      }

      const seedData = {
        users: initialUsers,
        sessions: [],
        bots: this.getSeedBots(),
        tradeLogs: this.getSeedTradeLogs(),
        securityAuditLogs: this.getSeedSecurityLogs(),
        riskSettings: {
          maxDailyDrawdown: 8.0,
          maxAccountDrawdown: 15.0,
          globalKillSwitch: false,
          maxLeverageLimit: 10,
          dailyLossLimitUSD: 800,
          restrictedSymbols: ["SHIB/USDT", "DOGE/USDT"],
          singleAssetMaxAllocationPercent: 40,
          industryCryptoMaxPercent: 60,
          autoMeltDrawdownThreshold: 12.0,
          autoMeltSharpeThreshold: 0.8
        },
        ibConnectionMode: "web_api_proxy",
        brokerAccounts: [],
        orders: [],
        fills: [],
        mfaActionTokens: [],
        preauthSessions: []
      };
      this.updateDataInPlace(seedData);

      const TEMP_FILE = JSON_FILE + ".tmp";
      try {
        fs.writeFileSync(TEMP_FILE, JSON.stringify(this.data, null, 2), "utf-8");
        fs.renameSync(TEMP_FILE, JSON_FILE);
      } catch (err) {
        console.error("Database save failed:", err);
      }
      return;
    }

    const SQLITE_FILE = path.join(this.dbDir, "aegis_secure.db");

    return new Promise<void>((resolve, reject) => {
      const sqlite = sqlite3.verbose();
      const sqliteDb = new sqlite.Database(SQLITE_FILE, (err) => {
        if (err) {
          console.error("Failed to connect to SQLite:", err);
          return reject(err);
        }
        
        this.sqliteDbConn = sqliteDb;
        
        const exec = (sql: string, params: any[] = []): Promise<void> => new Promise((res, rej) => sqliteDb.run(sql, params, e => e ? rej(e) : res()));
        const query = (sql: string, params: any[] = []): Promise<any[]> => new Promise((res, rej) => sqliteDb.all(sql, params, (e, rows) => e ? rej(e) : res(rows)));
        let hasDbState = false;

        (async () => {
          try {
            const tables = await query("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.map((t: any) => t.name);
            try {
              const sqlitePath = path.join(this.dbDir, "aegis_secure.db");
              if (fs.existsSync(sqlitePath) && fs.statSync(sqlitePath).size > 0) {
                hasDbState = true;
              } else {
                hasDbState = tableNames.includes('aegis_kv') || tableNames.includes('schema_migrations');
              }
            } catch (e) {
              hasDbState = tableNames.includes('aegis_kv') || tableNames.includes('schema_migrations');
            }
            
            if (hasDbState && process.env.NODE_ENV === "production") {
              if (!tableNames.includes("orders") || !tableNames.includes("fills")) {
                throw new Error("STRUCTURED_SCHEMA_INVALID: orders or fills table missing in an existing database");
              }
            }
          } catch (e) {
            console.error("Schema validation failed:", e);
            return reject(e);
          }

          sqliteDb.serialize(() => {
            // Main KV table for schema fallback
          sqliteDb.run("CREATE TABLE IF NOT EXISTS aegis_kv (key TEXT PRIMARY KEY, value TEXT)", (createKvErr) => {
            if (createKvErr) {
              console.error("Failed to create aegis_kv table:", createKvErr);
            }
          });

          // Structured preauth table for atomic transactional consumption (P0-3)
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS preauth_sessions (
              preauth_id_hash TEXT PRIMARY KEY,
              username TEXT NOT NULL,
              role TEXT NOT NULL,
              ip_hash TEXT,
              user_agent_hash TEXT,
              expires_at INTEGER NOT NULL,
              used_at INTEGER,
              failures INTEGER DEFAULT 0
            )
          `, (err) => {
            if (err) console.error("Failed to create preauth_sessions table:", err);
          });

          // Structured MFA tokens table for atomic transactional verification (P0-3)
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS mfa_action_tokens (
              token_hash TEXT PRIMARY KEY,
              session_id_hash TEXT NOT NULL,
              username TEXT NOT NULL,
              action TEXT NOT NULL,
              body_hash TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              used_at INTEGER
            )
          `, (err) => {
            if (err) console.error("Failed to create mfa_action_tokens table:", err);
          });

          // Structured fills table for deduplication and persistence (P1-3)
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS fills (
              id TEXT PRIMARY KEY,
              orderId TEXT NOT NULL,
              brokerFillId TEXT NOT NULL,
              price REAL NOT NULL,
              quantity REAL NOT NULL,
              fee REAL NOT NULL,
              feeCurrency TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              UNIQUE(orderId, brokerFillId)
            )
          `, (err) => {
            if (err) console.error("Failed to create fills table:", err);
          });

          // Structured orders table for database-level persistence and transaction protection (P1-5)
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY,
              botId TEXT NOT NULL,
              broker TEXT NOT NULL,
              brokerAccountId TEXT NOT NULL,
              clientOrderId TEXT NOT NULL UNIQUE,
              brokerOrderId TEXT,
              symbol TEXT NOT NULL,
              marketType TEXT NOT NULL DEFAULT 'spot',
              marginMode TEXT,
              positionSide TEXT,
              exchangeSymbol TEXT,
              side TEXT NOT NULL,
              type TEXT NOT NULL,
              price REAL NOT NULL,
              quantity REAL NOT NULL,
              status TEXT NOT NULL,
              createdAt TEXT NOT NULL,
              updatedAt TEXT NOT NULL,
              lastError TEXT
            )
          `, async (err) => {
            if (err) {
              console.error("Failed to create orders table:", err);
            } else {
              // Migration Runner
              try {
                const exec = (sql: string, params: any[] = []): Promise<void> => new Promise((res, rej) => sqliteDb.run(sql, params, e => e ? rej(e) : res()));
                const query = (sql: string, params: any[] = []): Promise<any[]> => new Promise((res, rej) => sqliteDb.all(sql, params, (e, rows) => e ? rej(e) : res(rows)));
                
                await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)`);
                
                const migrations = [
                  { version: 1, sql: `ALTER TABLE orders ADD COLUMN marketType TEXT NOT NULL DEFAULT 'spot'` },
                  { version: 2, sql: `ALTER TABLE orders ADD COLUMN marginMode TEXT` },
                  { version: 3, sql: `ALTER TABLE orders ADD COLUMN positionSide TEXT` },
                  { version: 4, sql: `ALTER TABLE orders ADD COLUMN exchangeSymbol TEXT` },
                  { version: 5, sql: `ALTER TABLE orders ADD COLUMN cancelRequestedAt TEXT` },
                  { version: 6, sql: `ALTER TABLE orders ADD COLUMN cancelRetryCount INTEGER` },
                  { version: 7, sql: `ALTER TABLE orders ADD COLUMN lastBrokerStatus TEXT` },
                  { version: 8, sql: `ALTER TABLE orders ADD COLUMN manualReviewRequired INTEGER DEFAULT 0` },
                  { version: 9, sql: `ALTER TABLE orders ADD COLUMN pollErrorCount INTEGER DEFAULT 0` }
                ];

                const appliedMigrations = await query(`SELECT version FROM schema_migrations`);
                const appliedSet = new Set(appliedMigrations.map(r => r.version));

                for (const m of migrations) {
                  if (!appliedSet.has(m.version)) {
                    try {
                      await exec(m.sql);
                    } catch (e: any) {
                      if (!e.message.includes("duplicate column name")) {
                        throw e;
                      }
                    }
                    await exec(`INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)`, [m.version, new Date().toISOString()]);
                  }
                }
              } catch (migErr) {
                console.error("Migration failed:", migErr);
                return reject(migErr);
              }
            }

            // Fetch state AFTER migrations
            const loadStructuredTradingTables = () => {
              return new Promise<void>(async (res, rej) => {
                // Post-migration schema validation
                if (hasDbState && process.env.NODE_ENV === "production") {
                  try {
                    const query = (sql: string, params: any[] = []): Promise<any[]> => new Promise((resolveQuery, rejectQuery) => sqliteDb.all(sql, params, (e, rows) => e ? rejectQuery(e) : resolveQuery(rows)));
                    const orderColumns = await query("PRAGMA table_info(orders)");
                    const requiredOrderColumns = [
                      "id", "botId", "broker", "brokerAccountId", "clientOrderId",
                      "symbol", "marketType", "side", "type", "price", "quantity",
                      "status", "createdAt", "updatedAt",
                      "pollErrorCount", "manualReviewRequired", "lastBrokerStatus"
                    ];
                    const colNames = orderColumns.map((c: any) => c.name);
                    for (const rc of requiredOrderColumns) {
                      if (!colNames.includes(rc)) {
                        return rej(new Error(`STRUCTURED_SCHEMA_INVALID: orders table missing required column ${rc}`));
                      }
                    }

                    const fillColumns = await query("PRAGMA table_info(fills)");
                    const requiredFillColumns = [
                      "id", "orderId", "brokerFillId", "price", "quantity",
                      "fee", "feeCurrency", "timestamp"
                    ];
                    const fillColNames = fillColumns.map((c: any) => c.name);
                    for (const rc of requiredFillColumns) {
                      if (!fillColNames.includes(rc)) {
                        return rej(new Error(`STRUCTURED_SCHEMA_INVALID: fills table missing required column ${rc}`));
                      }
                    }
                  } catch (validationErr) {
                    return rej(validationErr);
                  }
                }

                sqliteDb.all("SELECT * FROM orders ORDER BY createdAt DESC", (orderErr, orderRows) => {
                  if (orderErr) {
                    console.error("[DB-SQLite] STRUCTURED_RESTORE_FAILED for orders:", orderErr);
                    if (process.env.NODE_ENV === "production") return rej(orderErr);
                  } else if (orderRows && orderRows.length > 0) {
                    this.data.orders = orderRows.map((r: any) => ({
                      id: r.id,
                      botId: r.botId,
                      broker: r.broker,
                      brokerAccountId: r.brokerAccountId,
                      clientOrderId: r.clientOrderId,
                      brokerOrderId: r.brokerOrderId || undefined,
                      symbol: r.symbol,
                      marketType: r.marketType,
                      marginMode: r.marginMode || undefined,
                      positionSide: r.positionSide || undefined,
                      exchangeSymbol: r.exchangeSymbol || undefined,
                      side: r.side,
                      type: r.type,
                      price: Number(r.price),
                      quantity: Number(r.quantity),
                      status: r.status,
                      createdAt: r.createdAt,
                      updatedAt: r.updatedAt,
                      lastError: r.lastError || undefined,
                      cancelRequestedAt: r.cancelRequestedAt || undefined,
                      cancelRetryCount: r.cancelRetryCount ? Number(r.cancelRetryCount) : undefined,
                      pollErrorCount: r.pollErrorCount ? Number(r.pollErrorCount) : undefined,
                      lastBrokerStatus: r.lastBrokerStatus || undefined,
                      manualReviewRequired: r.manualReviewRequired === 1
                    }));
                  }
                  
                  sqliteDb.all("SELECT * FROM fills ORDER BY timestamp DESC", (fillErr, fillRows) => {
                    if (fillErr) {
                      console.error("[DB-SQLite] STRUCTURED_RESTORE_FAILED for fills:", fillErr);
                      if (process.env.NODE_ENV === "production") return rej(fillErr);
                    } else if (fillRows && fillRows.length > 0) {
                      this.data.fills = fillRows.map((r: any) => ({
                        id: r.id,
                        orderId: r.orderId,
                        brokerFillId: r.brokerFillId,
                        price: Number(r.price),
                        quantity: Number(r.quantity),
                        fee: Number(r.fee),
                        feeCurrency: r.feeCurrency,
                        timestamp: r.timestamp
                      }));
                    }
                    res();
                  });
                });
              });
            };

            sqliteDb.get("SELECT value FROM aegis_kv WHERE key = 'database_state'", async (selectErr, row: any) => {
              if (selectErr) {
                console.error("Failed to fetch state from SQLite:", selectErr);
                return reject(selectErr);
              }
              
              let parsedState: any;

              if (row && row.value) {
                try {
                  parsedState = JSON.parse(row.value);
                } catch (jsonErr) {
                  console.error("Failed to parse SQLite state JSON:", jsonErr);
                  if (hasDbState && process.env.NODE_ENV === "production") {
                    if (process.env.ALLOW_KV_RESEED_ON_CORRUPTION === "true" && process.env.CONFIRM_KV_RESEED_RESETS_AUTH_STATE === "YES_I_UNDERSTAND") {
                      console.warn("KV reseed override used due to JSON parse error.");
                      this.appendSecurityLog("system", "admin", "KV_RESEED_OVERRIDE_USED", "database_state", "KV reseed override used during production boot.");
                    } else {
                      return reject(new Error("KV_STATE_INVALID: database_state corrupted; restore from backup required"));
                    }
                  }
                  await this.seedAndSave(sqliteDb);
                  parsedState = this.data;
                }
              } else {
                if (hasDbState && process.env.NODE_ENV === "production") {
                  if (process.env.ALLOW_KV_RESEED_ON_CORRUPTION === "true" && process.env.CONFIRM_KV_RESEED_RESETS_AUTH_STATE === "YES_I_UNDERSTAND") {
                    console.warn("KV reseed override used due to missing database_state.");
                    this.appendSecurityLog("system", "admin", "KV_RESEED_OVERRIDE_USED", "database_state", "KV reseed override used during production boot.");
                  } else {
                    return reject(new Error("KV_STATE_INVALID: database_state missing; restore from backup required"));
                  }
                }
                await this.seedAndSave(sqliteDb);
                parsedState = this.data;
              }

              this.updateDataInPlace(parsedState);

              try {
                await loadStructuredTradingTables();
                resolve();
              } catch (structuredErr) {
                console.error("Failed to load structured tables:", structuredErr);
                reject(structuredErr);
              }
            });
          });
        });
      })();
    });
  });
}

  private getSeedBots(): BotConfig[] {
    return [
      {
        id: "bot_1",
        name: "Binance Spot BTC Grid",
        isEnabled: true,
        broker: "Binance",
        symbol: "BTC/USDT",
        type: "spot_grid",
        direction: "neutral",
        rangeMin: 60000,
        rangeMax: 70000,
        gridCount: 10,
        investment: 2000,
        leverage: 1,
        stopLoss: 59000,
        takeProfit: 71000,
        status: "running",
        profitUsd: 145.20,
        profitPercent: 7.26,
        unrealizedProfitUsd: 22.40,
        tradesCount: 18,
        grids: this.generateGrids(60000, 70000, 10, 64200, 2000 / 10),
        entryPrice: 63500,
        currentPrice: 64200,
        lastUpdated: new Date().toISOString(),
        timezone: "UTC",
        cgroupsCpuLimit: "Max 50% CPU",
        cgroupsMemoryLimit: "Max 3G RAM",
        executionMode: "paper",
        gridType: "spot",
        fundingRateCheck: false,
        pid: 4210,
        memoryHeapMb: 98.4,
        cpuAffinity: "CPU Core 0",
        version: "1.0.0",
        configHistory: [
          {
            version: "1.0.0",
            timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
            rangeMin: 60000,
            rangeMax: 70000,
            gridCount: 10,
            investment: 2000,
            leverage: 1,
          }
        ]
      },
      {
        id: "bot_2",
        name: "OKX Futures ETH Long",
        isEnabled: true,
        broker: "OKX",
        symbol: "ETH/USDT",
        type: "futures_grid",
        direction: "long",
        rangeMin: 3100,
        rangeMax: 3600,
        gridCount: 8,
        investment: 1000,
        leverage: 5,
        stopLoss: 2900,
        takeProfit: 3800,
        status: "running",
        profitUsd: 84.50,
        profitPercent: 8.45,
        unrealizedProfitUsd: -12.30,
        tradesCount: 12,
        grids: this.generateGrids(3100, 3600, 8, 3350, 1000 * 5 / 8),
        entryPrice: 3300,
        currentPrice: 3350,
        lastUpdated: new Date().toISOString(),
        timezone: "UTC",
        cgroupsCpuLimit: "Max 50% CPU",
        cgroupsMemoryLimit: "Max 3G RAM",
        executionMode: "paper",
        gridType: "perpetual",
        perpetualLeverage: 5,
        fundingRateCheck: true,
        pid: 4211,
        memoryHeapMb: 112.1,
        cpuAffinity: "CPU Core 1",
        version: "1.0.0",
        configHistory: [
          {
            version: "1.0.0",
            timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
            rangeMin: 3100,
            rangeMax: 3600,
            gridCount: 8,
            investment: 1000,
            leverage: 5,
          }
        ],
        liquidationPrice: Math.round(3300 * (1 - (1 * 0.8) / 5) * 100) / 100,
        maintenanceMargin: Math.round(1000 * 0.05 * 100) / 100
      }
    ];
  }

  private getSeedTradeLogs(): TradeLog[] {
    const seedLogs: any[] = [
      {
        id: "tx_1",
        botId: "bot_1",
        botName: "Binance Spot BTC Grid",
        broker: "Binance",
        symbol: "BTC/USDT",
        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        type: "buy",
        price: 63800,
        amount: 0.0031,
        total: 197.78,
        pnl: 0
      },
      {
        id: "tx_2",
        botId: "bot_1",
        botName: "Binance Spot BTC Grid",
        broker: "Binance",
        symbol: "BTC/USDT",
        timestamp: new Date(Date.now() - 3600000 * 2.5).toISOString(),
        type: "sell",
        price: 64800,
        amount: 0.0031,
        total: 200.88,
        pnl: 3.10
      }
    ];

    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
    for (let i = seedLogs.length - 1; i >= 0; i--) {
      const log = seedLogs[i] as any;
      log.previousHash = prevHash;
      log.currentHash = computeLogHash(log, prevHash);
      prevHash = log.currentHash;
    }
    return seedLogs as TradeLog[];
  }

  private getSeedSecurityLogs(): SecurityAuditEntry[] {
    const seedSec = [
      { action: "INTEGRITY_CHECK", target: "HASH_CHAIN_DB", details: "Verified trade records cryptographic sequence consistency. Chains matches. Status: SAFE." },
      { action: "COMPLIANCE_BOOT", target: "FIREWALL_RULES", details: "Enforced loopback listener restriction for node executor. Oracle ARM isolated." }
    ];
    let prevSecHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const result: SecurityAuditEntry[] = [];
    for (const log of seedSec) {
      const entry: SecurityAuditEntry = {
        id: "sec_" + Math.random().toString(36).substring(2, 11),
        timestamp: new Date().toISOString(),
        username: "system",
        role: "admin",
        action: log.action,
        target: log.target,
        details: log.details,
        ipAddress: "127.0.0.1",
        previousHash: prevSecHash,
        currentHash: ""
      };
      entry.currentHash = computeSecurityHash(entry, prevSecHash);
      result.unshift(entry);
      prevSecHash = entry.currentHash;
    }
    return result;
  }

  private generateGrids(min: number, max: number, count: number, currentPrice: number, gridFund: number) {
    const lines: any[] = [];
    const step = (max - min) / (count - 1);
    for (let i = 0; i < count; i++) {
      const price = Math.round((min + i * step) * 100) / 100;
      const type = price < currentPrice ? "buy" : "sell";
      lines.push({
        price,
        type,
        filled: false,
        amount: Math.round((gridFund / price) * 10000) / 10000,
      });
    }
    return lines;
  }

  public get() {
    return this.data;
  }

  public close() {
    if (this.sqliteDbConn) {
      try {
        this.sqliteDbConn.close();
      } catch (e) {
        console.error("Failed to close SQLite connection:", e);
      }
    }
  }

  public saveAsync(): Promise<void> {
    const dataToSave = { ...this.data };
    if (isSqliteSupported) {
      delete (dataToSave as any).preauthSessions;
      delete (dataToSave as any).mfaActionTokens;
    }

    const payload = JSON.stringify(dataToSave, null, 2);

    if (!isSqliteSupported) {
      return new Promise((resolve, reject) => {
        const JSON_FILE = path.join(this.dbDir, "aegis_secure.json");
        const TEMP_FILE = JSON_FILE + ".tmp";
        fs.promises.writeFile(TEMP_FILE, payload, "utf-8")
          .then(() => fs.promises.rename(TEMP_FILE, JSON_FILE))
          .then(resolve)
          .catch((err) => {
             console.error("[Aegis DB] Error writing JSON file", err);
             reject(err);
          });
      });
    }

    return new Promise((resolve, reject) => {
      if (!this.sqliteDbConn) return resolve();
      this.sqliteDbConn.run(
        "INSERT INTO aegis_kv (key, value) VALUES ('database_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [payload],
        function (err: any) {
          if (err) {
            console.error("[Aegis DB] KV_SNAPSHOT_WRITE_FAILED:", err);
            // We resolve because structured tables were successfully written
            resolve();
          } else {
            resolve();
          }
        }
      );
    });
  }

  public save() {
    const dataToSave = { ...this.data };
    if (isSqliteSupported) {
      delete (dataToSave as any).preauthSessions;
      delete (dataToSave as any).mfaActionTokens;
    }

    const payload = JSON.stringify(dataToSave, null, 2);

    if (!isSqliteSupported) {
      const JSON_FILE = path.join(this.dbDir, "aegis_secure.json");
      const TEMP_FILE = JSON_FILE + ".tmp";
      try {
        fs.writeFileSync(TEMP_FILE, payload, "utf-8");
        fs.renameSync(TEMP_FILE, JSON_FILE);
      } catch (err) {
        console.error("Database save failed:", err);
      }
      return;
    }

    if (this.sqliteDbConn) {
      this.sqliteDbConn.run(
        "INSERT INTO aegis_kv (key, value) VALUES ('database_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [payload],
        (runErr: any) => {
          if (runErr) {
            console.error("Failed to save state to SQLite via connection:", runErr);
          }
        }
      );
    } else {
      const SQLITE_FILE = path.join(this.dbDir, "aegis_secure.db");
      const sqlite = sqlite3.verbose();
      const sqliteDb = new sqlite.Database(SQLITE_FILE, (err) => {
        if (err) {
          console.error("Failed to open SQLite for saving:", err);
          return;
        }
        sqliteDb.run(
          "INSERT INTO aegis_kv (key, value) VALUES ('database_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [payload],
          (runErr) => {
            if (runErr) {
              console.error("Failed to save state to SQLite fallback:", runErr);
            }
            sqliteDb.close();
          }
        );
      });
    }
  }

  public appendSecurityLog(username: string, role: 'admin' | 'operator' | 'viewer', action: string, target: string, details: string, ip: string = "127.0.0.1") {
    const prev = this.data.securityAuditLogs.length > 0 ? this.data.securityAuditLogs[0].currentHash : "0000000000000000000000000000000000000000000000000000000000000000";
    const entry: SecurityAuditEntry = {
      id: "sec_" + Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      username,
      role,
      action,
      target,
      details,
      ipAddress: ip,
      previousHash: prev,
      currentHash: ""
    };
    entry.currentHash = computeSecurityHash(entry, prev);
    this.data.securityAuditLogs.unshift(entry);
    this.save();
  }

  public appendTradeLog(log: Omit<TradeLog, "previousHash" | "currentHash">): TradeLog {
    const prev = this.data.tradeLogs.length > 0 ? this.data.tradeLogs[0].currentHash || "0000000000000000000000000000000000000000000000000000000000000000" : "0000000000000000000000000000000000000000000000000000000000000000";
    const newLog: TradeLog = {
      ...log,
      previousHash: prev,
      currentHash: ""
    };
    newLog.currentHash = computeLogHash(newLog, prev);
    this.data.tradeLogs.unshift(newLog);
    this.save();
    return newLog;
  }

  public upsertBot(bot: BotConfig) {
    const idx = this.data.bots.findIndex(b => b.id === bot.id);
    if (idx >= 0) {
      this.data.bots[idx] = bot;
    } else {
      this.data.bots.push(bot);
    }
    this.save();
  }

  public deleteBot(id: string) {
    this.data.bots = this.data.bots.filter(b => b.id !== id);
    this.save();
  }

  public upsertUser(u: DBUser) {
    const idx = this.data.users.findIndex(user => user.username === u.username);
    if (idx >= 0) {
      this.data.users[idx] = u;
    } else {
      this.data.users.push(u);
    }
    this.save();
  }

  public deleteUser(username: string) {
    this.data.users = this.data.users.filter(user => user.username !== username);
    this.data.sessions = this.data.sessions.filter(s => s.username !== username);
    this.save();
  }

  public upsertSession(s: DBSession) {
    const idx = this.data.sessions.findIndex(sess => sess.tokenHash === s.tokenHash);
    if (idx >= 0) {
      this.data.sessions[idx] = s;
    } else {
      this.data.sessions.push(s);
    }
    this.save();
  }

  public deleteSession(tokenHash: string) {
    this.data.sessions = this.data.sessions.filter(s => s.tokenHash !== tokenHash);
    this.save();
  }

  public updateRiskSettings(r: RiskSettings) {
    this.data.riskSettings = r;
    this.save();
  }

  public updateIbConnectionMode(mode: 'gateway' | 'web_api_proxy') {
    this.data.ibConnectionMode = mode;
    this.save();
  }

  public upsertBrokerAccount(acc: BrokerAccount) {
    const idx = this.data.brokerAccounts.findIndex(a => a.id === acc.id);
    if (idx >= 0) {
      this.data.brokerAccounts[idx] = acc;
    } else {
      this.data.brokerAccounts.push(acc);
    }
    this.save();
  }

  public deleteBrokerAccount(id: string) {
    this.data.brokerAccounts = this.data.brokerAccounts.filter(a => a.id !== id);
    this.save();
  }

  public insertOrder(ord: Order): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.sqliteDbConn) {
        this.sqliteDbConn.run(
          "INSERT INTO orders (id, botId, broker, brokerAccountId, clientOrderId, brokerOrderId, symbol, marketType, marginMode, positionSide, exchangeSymbol, side, type, price, quantity, status, createdAt, updatedAt, lastError, pollErrorCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [ord.id, ord.botId, ord.broker, ord.brokerAccountId, ord.clientOrderId, ord.brokerOrderId || null, ord.symbol, ord.marketType || 'spot', ord.marginMode || null, ord.positionSide || null, ord.exchangeSymbol || null, ord.side, ord.type, ord.price, ord.quantity, ord.status, ord.createdAt, ord.updatedAt, ord.lastError || null, ord.pollErrorCount || 0],
          (err) => {
            if (err) {
              if (err.message.includes("UNIQUE constraint failed")) {
                console.log(`[DB-SQLite] Unique constraint hit. Duplicate order skipped: ${ord.clientOrderId}`);
                return resolve(false);
              } else {
                console.error("[DB-SQLite] Failed to insert order:", err);
                return reject(err);
              }
            }
            this.data.orders.unshift(ord);
            this.saveAsync().then(() => resolve(true)).catch(reject);
          }
        );
        return;
      }
      
      const exists = this.data.orders.some((o: Order) => o.clientOrderId === ord.clientOrderId);
      if (!exists) {
        this.data.orders.unshift(ord);
        this.saveAsync().then(() => resolve(true)).catch(reject);
      } else {
        resolve(false);
      }
    });
  }

  private readonly ORDER_TRANSITIONS: Record<string, string[]> = {
    "ORDER_INTENT_CREATED": ["PENDING", "REJECTED", "CANCEL_REQUESTED"],
    "PENDING": ["WORKING", "NEW", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCEL_REQUESTED", "CANCELED", "PENDING_UNKNOWN"],
    "PENDING_UNKNOWN": ["WORKING", "NEW", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCEL_REQUESTED", "CANCELED"],
    "NEW": ["WORKING", "PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "REJECTED", "PENDING_UNKNOWN"],
    "WORKING": ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "CANCELED", "REJECTED", "PENDING_UNKNOWN"],
    "PARTIALLY_FILLED": ["FILLED", "CANCEL_REQUESTED", "CANCELED", "REJECTED", "PENDING_UNKNOWN"],
    "CANCEL_REQUESTED": ["CANCELED", "FILLED", "PARTIALLY_FILLED", "CANCEL_FAILED", "PENDING_UNKNOWN"],
    "CANCEL_FAILED": ["CANCEL_REQUESTED", "WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELED", "PENDING_UNKNOWN"],
    "FILLED": [],
    "CANCELED": [],
    "REJECTED": []
  };

  private assertOrderTransition(from: string, to: string, clientOrderId: string, bypassTransition: boolean = false): boolean {
    if (bypassTransition) return true;
    const allowedTransitions = this.ORDER_TRANSITIONS[from] || [];
    if (!allowedTransitions.includes(to) && from !== to) {
      console.error(`[ORDER STATE MACHINE ERROR] Invalid transition ${from} -> ${to} for order ${clientOrderId}`);
      this.appendSecurityLog("system", "admin", "ORDER_STATE_MACHINE_VIOLATION", clientOrderId, `Attempted invalid transition from ${from} to ${to}`);
      return false;
    }
    return true;
  }

  public updateOrderState(clientOrderId: string, updates: Partial<Order> & { bypassTransition?: boolean, allowMissing?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const ord = this.data.orders.find((o: Order) => o.clientOrderId === clientOrderId);
      if (ord) {
        if (updates.status && updates.status !== ord.status) {
          if (!this.assertOrderTransition(ord.status, updates.status, clientOrderId, updates.bypassTransition)) {
            return reject(new Error("Invalid state transition"));
          }
        }
        
        Object.assign(ord, updates);
        delete (ord as any).bypassTransition;
        delete (ord as any).allowMissing;
        ord.updatedAt = new Date().toISOString();
        if (this.sqliteDbConn) {
          const db = this;
          this.sqliteDbConn.run(
            "UPDATE orders SET status = ?, brokerOrderId = ?, lastError = ?, updatedAt = ?, cancelRetryCount = ?, cancelRequestedAt = ?, pollErrorCount = ?, lastBrokerStatus = ?, manualReviewRequired = ? WHERE clientOrderId = ?",
            [ord.status, ord.brokerOrderId || null, ord.lastError || null, ord.updatedAt, ord.cancelRetryCount || 0, ord.cancelRequestedAt || null, ord.pollErrorCount || 0, ord.lastBrokerStatus || null, ord.manualReviewRequired ? 1 : 0, clientOrderId],
            function (this: any, err: any) {
              if (err) return reject(err);
              if (this.changes !== 1) {
                db.appendSecurityLog(
                  "system",
                  "admin",
                  "ORDER_SQLITE_UPDATE_MISSING_ROW",
                  clientOrderId,
                  "SQLite order update affected 0 rows while memory order existed."
                );
                return reject(new Error(`SQLite order row missing: ${clientOrderId}`));
              }
              db.saveAsync().then(() => resolve()).catch(reject);
            }
          );
        } else {
          this.saveAsync().then(() => resolve()).catch(reject);
        }
      } else {
        if (!updates.allowMissing) {
          this.appendSecurityLog(
            "system",
            "admin",
            "ORDER_STATE_UPDATE_MISSING_ORDER",
            clientOrderId,
            `Attempted to update missing order with status ${updates.status || "UNCHANGED"}`
          );
          return reject(new Error(`Order not found: ${clientOrderId}`));
        }
        resolve();
      }
    });
  }

  public async updateOrderStatus(clientOrderId: string, status: Order["status"], brokerOrderId?: string, lastError?: string): Promise<void> {
    await this.updateOrderState(clientOrderId, { status, brokerOrderId, lastError });
  }

  public insertFill(fill: Fill): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.data.fills) this.data.fills = [];
      const exists = this.data.fills.some(
        (f: any) => f.id === fill.id || 
             (f.orderId === fill.orderId && f.brokerFillId === fill.brokerFillId)
      );
      if (exists) {
        console.log(`[DB-Memory] Fill ${fill.brokerFillId} for order ${fill.orderId} already exists. Skipping duplicate.`);
        return resolve(false);
      }

      if (this.sqliteDbConn) {
        this.sqliteDbConn.run(
          "INSERT INTO fills (id, orderId, brokerFillId, price, quantity, fee, feeCurrency, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [fill.id, fill.orderId, fill.brokerFillId, fill.price, fill.quantity, fill.fee, fill.feeCurrency, fill.timestamp],
          (err: any) => {
            if (err) {
              if (err.message.includes("UNIQUE constraint failed")) {
                console.log(`[DB-SQLite] Unique constraint hit. Duplicate fill skipped: ${fill.brokerFillId} for order ${fill.orderId}`);
                return resolve(false);
              } else {
                console.error("[DB-SQLite] Failed to insert fill:", err);
                return reject(err);
              }
            }
            // Only push to memory and save state after successful DB insert
            this.data.fills.unshift(fill);
            this.saveAsync().then(() => resolve(true)).catch(reject);
          }
        );
      } else {
        // Memory fallback if sqlite is not connected (e.g. testing/bootstrap)
        this.data.fills.unshift(fill);
        this.saveAsync().then(() => resolve(true)).catch(reject);
      }
    });
  }

  public async recordExecutionUpdateSequentially(params: {
    orderId: string;
    clientOrderId: string;
    nextStatus: string;
    brokerOrderId?: string;
    botId: string;
    fillsToProcess: Array<{
      fill: Fill;
      log?: Omit<TradeLog, "previousHash" | "currentHash">;
      pnlIncrement: number;
      feeIncrement: number;
    }>;
    botGridUpdates?: {
      targetPrice: number;
      side: string;
    };
  }): Promise<void> {
    const bot = this.data.bots.find(b => b.id === params.botId);
    
    // Attempt to insert fills first
    for (const item of params.fillsToProcess) {
      const inserted = await this.insertFill(item.fill);
      if (inserted) {
        if (item.log) {
          this.appendTradeLog(item.log);
        }
        if (bot) {
          if (item.pnlIncrement !== 0) {
            bot.profitUsd += item.pnlIncrement;
            bot.profitUsd -= item.feeIncrement;
          } else {
            bot.profitUsd -= item.feeIncrement;
          }
          bot.profitUsd = Math.round(bot.profitUsd * 100) / 100;
          bot.profitPercent = Math.round((bot.profitUsd / bot.investment) * 10000) / 100;
          bot.tradesCount++;
        }
      }
    }

    if (bot && params.botGridUpdates) {
      const gridIndex = bot.grids.findIndex((g: any) => Math.abs(g.price - params.botGridUpdates!.targetPrice) < 0.0001 && g.type === params.botGridUpdates!.side);
      if (gridIndex !== -1) {
        bot.grids[gridIndex].filled = false;
        bot.grids[gridIndex].type = params.botGridUpdates!.side === "buy" ? "sell" : "buy";
      }
    }

    // Update order status
    await this.updateOrderState(params.clientOrderId, { status: params.nextStatus as any, brokerOrderId: params.brokerOrderId });

    // Update Bot
    if (bot) {
      this.upsertBot(bot);
    }
  }

  public getMfaTokensDb(callback: (err: any, rows: any[]) => void) {
    callback(null, this.data.mfaActionTokens || []);
  }

  public insertMfaToken(
    tokenHash: string,
    sessionIdHash: string,
    username: string,
    action: string,
    bodyHash: string,
    expiresAt: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const doMemoryAndSave = () => {
        if (!this.data.mfaActionTokens) this.data.mfaActionTokens = [];
        this.data.mfaActionTokens.push({
          tokenHash,
          sessionIdHash,
          username,
          action,
          bodyHash,
          expiresAt,
          usedAt: null
        });
        this.save();
      };

      if (isSqliteSupported && this.sqliteDbConn) {
        this.sqliteDbConn.run(
          `INSERT INTO mfa_action_tokens (token_hash, session_id_hash, username, action, body_hash, expires_at, used_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [tokenHash, sessionIdHash, username, action, bodyHash, expiresAt],
          (err: any) => {
            if (err) {
              console.error("Failed to insert mfa_action_token into SQLite table:", err);
              return reject(new Error("Failed to insert MFA token into secure SQLite storage: " + err.message));
            }
            doMemoryAndSave();
            resolve();
          }
        );
      } else {
        doMemoryAndSave();
        resolve();
      }
    });
  }

  public consumeMfaTokenAsync(
    tokenHash: string,
    username: string,
    sessionIdHash: string,
    action: string,
    bodyHash: string
  ): Promise<void> {
    const now = Date.now();
    return new Promise<void>((resolve, reject) => {
      if (isSqliteSupported && this.sqliteDbConn) {
        this.sqliteDbConn.get(
          "SELECT expires_at, used_at FROM mfa_action_tokens WHERE token_hash = ? AND username = ? AND session_id_hash = ? AND action = ? AND body_hash = ?",
          [tokenHash, username, sessionIdHash, action, bodyHash],
          (err: any, row: any) => {
            if (err) {
              return reject(new Error("MFA authorization failed due to storage lookup error."));
            }
            if (!row) {
              return reject(new Error("MFA authorization failed: token not found or bound to a different context."));
            }
            if (row.used_at !== null) {
              return reject(new Error("MFA authorization failed: token already consumed."));
            }
            if (row.expires_at < now) {
              return reject(new Error("MFA authorization failed: token has expired."));
            }

            // Atomic consume
            this.sqliteDbConn.run(
              "UPDATE mfa_action_tokens SET used_at = ? WHERE token_hash = ? AND username = ? AND session_id_hash = ? AND action = ? AND body_hash = ? AND used_at IS NULL AND expires_at >= ?",
              [now, tokenHash, username, sessionIdHash, action, bodyHash, now],
              function (this: any, updateErr: any) {
                if (updateErr) {
                  return reject(new Error("Failed to consume MFA token transactionally."));
                }
                if (this.changes !== 1) {
                  return reject(new Error("MFA token double-use block triggered. Transaction aborted."));
                }
                resolve();
              }
            );
          }
        );
      } else {
        // Memory fallback
        if (!this.data.mfaActionTokens) this.data.mfaActionTokens = [];
        const token = this.data.mfaActionTokens.find(
          t => t.tokenHash === tokenHash &&
               t.username === username &&
               t.sessionIdHash === sessionIdHash &&
               t.action === action &&
               t.bodyHash === bodyHash &&
               !t.usedAt &&
               t.expiresAt >= now
        );
        if (!token) {
          return reject(new Error("MFA authorization failed: token is expired, already used, or bound to a different request context"));
        }
        token.usedAt = now;
        this.save();
        resolve();
      }
    });
  }

  public insertPreauthSession(
    preauthIdHash: string,
    username: string,
    role: 'admin' | 'operator' | 'viewer',
    expiresAt: number,
    ip: string = "127.0.0.1",
    userAgent: string = "unknown"
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const doMemoryAndSave = () => {
        if (!this.data.preauthSessions) this.data.preauthSessions = [];
        this.data.preauthSessions.push({ preauthIdHash, username, role, expiresAt, failures: 0 });
        this.save();
      };

      if (isSqliteSupported && this.sqliteDbConn) {
        const ip_hash = crypto.createHash("sha256").update(ip).digest("hex");
        const user_agent_hash = crypto.createHash("sha256").update(userAgent).digest("hex");
        
        this.sqliteDbConn.run(
          `INSERT INTO preauth_sessions (preauth_id_hash, username, role, ip_hash, user_agent_hash, expires_at, used_at, failures)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
          [preauthIdHash, username, role, ip_hash, user_agent_hash, expiresAt],
          (err: any) => {
            if (err) {
              console.error("Failed to insert preauth_session into SQLite table:", err);
              return reject(new Error("Failed to create preauth session in secure SQLite storage: " + err.message));
            }
            doMemoryAndSave();
            resolve();
          }
        );
      } else {
        doMemoryAndSave();
        resolve();
      }
    });
  }

  public getPreauthSession(preauthIdHash: string) {
    if (!this.data.preauthSessions) this.data.preauthSessions = [];
    const now = Date.now();
    this.data.preauthSessions = this.data.preauthSessions.filter(p => p.expiresAt >= now);
    return this.data.preauthSessions.find(p => p.preauthIdHash === preauthIdHash);
  }

  public consumePreauthSession(preauthIdHash: string) {
    if (!this.data.preauthSessions) this.data.preauthSessions = [];
    this.data.preauthSessions = this.data.preauthSessions.filter(p => p.preauthIdHash !== preauthIdHash);
    this.save();

    if (isSqliteSupported && this.sqliteDbConn) {
      const now = Date.now();
      this.sqliteDbConn.run(
        "UPDATE preauth_sessions SET used_at = ? WHERE preauth_id_hash = ?",
        [now, preauthIdHash]
      );
    }
  }

  public validatePreauthSessionAsync(
    preauthIdHash: string,
    clientIp: string = "",
    userAgent: string = ""
  ): Promise<{ username: string; role: 'admin' | 'operator' | 'viewer' }> {
    const now = Date.now();
    const ip_hash = crypto.createHash("sha256").update(clientIp).digest("hex");
    const user_agent_hash = crypto.createHash("sha256").update(userAgent).digest("hex");

    return new Promise((resolve, reject) => {
      if (isSqliteSupported && this.sqliteDbConn) {
        this.sqliteDbConn.get(
          "SELECT username, role, ip_hash, user_agent_hash, expires_at, used_at, failures FROM preauth_sessions WHERE preauth_id_hash = ?",
          [preauthIdHash],
          (err: any, row: any) => {
            if (err) {
              return reject(new Error("Database lookup error during 2FA."));
            }
            if (!row) {
              return reject(new Error("Invalid or expired login session. Please re-enter credentials."));
            }
            if (row.used_at !== null) {
              return reject(new Error("Secure alert: Login session has already been used. Double-use block triggered."));
            }
            if (row.expires_at < now) {
              return reject(new Error("Login session expired. Please re-enter credentials."));
            }
            if (row.failures >= 3) {
              return reject(new Error("Too many failed 2FA attempts. This login session has been locked."));
            }
            if (row.ip_hash !== ip_hash || row.user_agent_hash !== user_agent_hash) {
              // Immediately invalidate preauth session in SQLite to block further attempts from this context
              this.sqliteDbConn.run(
                "UPDATE preauth_sessions SET used_at = ? WHERE preauth_id_hash = ? AND used_at IS NULL",
                [now, preauthIdHash],
                (updateErr: any) => {
                  reject(new Error("Security context changed. IP or browser agent mismatch."));
                }
              );
              return;
            }
            resolve({ username: row.username, role: row.role });
          }
        );
      } else {
        if (!this.data.preauthSessions) this.data.preauthSessions = [];
        const p = this.data.preauthSessions.find(x => x.preauthIdHash === preauthIdHash);
        if (!p) {
          return reject(new Error("Invalid or expired login session. Please re-enter credentials."));
        }
        if (p.expiresAt < now) {
          this.data.preauthSessions = this.data.preauthSessions.filter(x => x.preauthIdHash !== preauthIdHash);
          this.save();
          return reject(new Error("Login session expired. Please re-enter credentials."));
        }
        const failures = p.failures || 0;
        if (failures >= 3) {
          this.data.preauthSessions = this.data.preauthSessions.filter(x => x.preauthIdHash !== preauthIdHash);
          this.save();
          return reject(new Error("Too many failed 2FA attempts. Session locked."));
        }
        resolve({ username: p.username, role: p.role });
      }
    });
  }

  public incrementPreauthFailuresAsync(preauthIdHash: string): Promise<void> {
    const now = Date.now();
    return new Promise((resolve) => {
      if (isSqliteSupported && this.sqliteDbConn) {
        this.sqliteDbConn.run(
          "UPDATE preauth_sessions SET failures = IFNULL(failures, 0) + 1 WHERE preauth_id_hash = ?",
          [preauthIdHash],
          () => {
            this.sqliteDbConn.run(
              "UPDATE preauth_sessions SET used_at = ? WHERE preauth_id_hash = ? AND failures >= 3",
              [now, preauthIdHash],
              () => resolve()
            );
          }
        );
      } else {
        if (!this.data.preauthSessions) this.data.preauthSessions = [];
        const p = this.data.preauthSessions.find(x => x.preauthIdHash === preauthIdHash);
        if (p) {
          p.failures = (p.failures || 0) + 1;
          if (p.failures >= 3) {
            this.data.preauthSessions = this.data.preauthSessions.filter(x => x.preauthIdHash !== preauthIdHash);
          }
          this.save();
        }
        resolve();
      }
    });
  }

  public consumePreauthSessionAsync(preauthIdHash: string): Promise<void> {
    const now = Date.now();
    const db = this;
    return new Promise((resolve, reject) => {
      if (isSqliteSupported && db.sqliteDbConn) {
        db.sqliteDbConn.run(
          "UPDATE preauth_sessions SET used_at = ? WHERE preauth_id_hash = ? AND used_at IS NULL AND expires_at >= ?",
          [now, preauthIdHash, now],
          function (this: any, err: any) {
            if (err) {
              return reject(new Error("Transaction execution error."));
            }
            if (this.changes !== 1) {
              return reject(new Error("Pre-authorization double-use protection block triggered."));
            }
            if (db.data.preauthSessions) {
              db.data.preauthSessions = db.data.preauthSessions.filter(p => p.preauthIdHash !== preauthIdHash);
              db.save();
            }
            resolve();
          }
        );
      } else {
        if (this.data.preauthSessions) {
          const originalLength = this.data.preauthSessions.length;
          this.data.preauthSessions = this.data.preauthSessions.filter(p => p.preauthIdHash !== preauthIdHash);
          if (this.data.preauthSessions.length === originalLength) {
            return reject(new Error("Pre-authorization double-use protection block triggered."));
          }
          this.save();
        } else {
          return reject(new Error("Pre-authorization double-use protection block triggered."));
        }
        resolve();
      }
    });
  }
}


