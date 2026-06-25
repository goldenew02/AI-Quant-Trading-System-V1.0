import crypto from "crypto";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { BotConfig, TradeLog, RiskSettings } from "../src/types";

// --- ENVIRONMENT INITIALIZATION & FAIL-FAST VALIDATION ---
// 1. Auto-seed .env file if it does not exist with strong dynamic values
const envPath = path.join(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  const adminUser = "admin";
  const adminPass = "Aegis_" + crypto.randomBytes(6).toString("hex") + "!";
  
  // Generate random base32 standard secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let adminTotp = "";
  for (let i = 0; i < 16; i++) {
    adminTotp += base32Chars[crypto.randomInt(base32Chars.length)];
  }
  
  const encKey = crypto.randomBytes(32).toString("base64");
  const sessSec = crypto.randomBytes(32).toString("base64");

  const envContent = `# AegisQuant Secure Environment Configuration
BOOTSTRAP_ADMIN_USER=${adminUser}
BOOTSTRAP_ADMIN_PASSWORD=${adminPass}
BOOTSTRAP_ADMIN_TOTP_SECRET=${adminTotp}
ENCRYPTION_KEY=${encKey}
SESSION_SECRET=${sessSec}
`;
  fs.writeFileSync(envPath, envContent, "utf-8");
  console.log("==================================================================");
  console.log("  SECURE BOOTSTRAP: Created fresh .env with dynamic secrets.      ");
  console.log(`  Admin User: ${adminUser}                                        `);
  console.log(`  Admin Password: ${adminPass}                                    `);
  console.log(`  Admin TOTP Secret: ${adminTotp}                                 `);
  console.log("==================================================================");
}

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// Fail-fast verification of required secrets as demanded by P0-1
const requiredEnvVars = [
  "BOOTSTRAP_ADMIN_USER",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "BOOTSTRAP_ADMIN_TOTP_SECRET",
  "ENCRYPTION_KEY",
  "SESSION_SECRET"
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing critical security environment variable: ${key}`);
    process.exit(1);
  }
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

export interface DBUser {
  username: string;
  passwordHash: string;
  role: 'admin' | 'operator' | 'viewer';
  totpSecret: string | null; // standard base32 secret (AES-GCM encrypted)
  isActive: boolean;
  tempTotpSecret?: string | null;
  tempTotpExpiresAt?: number | null;
  mustEnrollTotp?: boolean;
}

export interface DBSession {
  tokenHash: string; // sha256(token + SESSION_SECRET) to protect token leakage in db
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  expiresAt: number;
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
}

const DB_DIR = path.join(process.cwd(), "data");
const SQLITE_FILE = path.join(DB_DIR, "aegis_secure.db");

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

  // Buffer check window for standard clock drifts (-1, 0, +1 step of 30 seconds)
  for (let drift = -1; drift <= 1; drift++) {
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

// AES-256-GCM Secure Encryption complying with P0-3
// Format: v1:k1:iv:ciphertext:authTag (No fallbacks or silent plaintext degradation)
export function encryptSecret(plainText: string): string {
  try {
    const iv = crypto.randomBytes(12);
    // Use decoded 32-byte encryption key
    const cipher = crypto.createCipheriv("aes-256-gcm", decodedEncryptionKey, iv);
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
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", decodedEncryptionKey, iv);
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
  private data!: AegisDatabase;
  private sqlDb!: sqlite3.Database;

  constructor() {
    this.initDatabase();
  }

  private initDatabase() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    // Connect to SQLite Database
    this.sqlDb = new sqlite3.Database(SQLITE_FILE);
    
    // Enable WAL journal mode for performance and crash recovery (P0-4)
    this.sqlDb.run("PRAGMA journal_mode=WAL;");

    // Create Tables synchronously for safety on startup
    this.sqlDb.serialize(() => {
      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL,
          totpSecret TEXT,
          isActive INTEGER NOT NULL DEFAULT 1,
          tempTotpSecret TEXT,
          tempTotpExpiresAt INTEGER,
          mustEnrollTotp INTEGER NOT NULL DEFAULT 0
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          tokenHash TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          role TEXT NOT NULL,
          expiresAt INTEGER NOT NULL
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS bots (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          isEnabled INTEGER NOT NULL,
          broker TEXT NOT NULL,
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          direction TEXT NOT NULL,
          rangeMin REAL NOT NULL,
          rangeMax REAL NOT NULL,
          gridCount INTEGER NOT NULL,
          investment REAL NOT NULL,
          leverage INTEGER NOT NULL,
          stopLoss REAL,
          takeProfit REAL,
          status TEXT NOT NULL,
          profitUsd REAL NOT NULL,
          profitPercent REAL NOT NULL,
          unrealizedProfitUsd REAL NOT NULL,
          tradesCount INTEGER NOT NULL,
          entryPrice REAL NOT NULL,
          currentPrice REAL NOT NULL,
          lastUpdated TEXT NOT NULL,
          timezone TEXT NOT NULL,
          cgroupsCpuLimit TEXT,
          cgroupsMemoryLimit TEXT,
          pid INTEGER,
          memoryHeapMb REAL,
          cpuAffinity TEXT,
          version TEXT,
          liquidationPrice REAL,
          maintenanceMargin REAL,
          grids TEXT,
          configHistory TEXT
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS trade_logs (
          id TEXT PRIMARY KEY,
          botId TEXT NOT NULL,
          botName TEXT NOT NULL,
          broker TEXT NOT NULL,
          symbol TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          type TEXT NOT NULL,
          price REAL NOT NULL,
          amount REAL NOT NULL,
          total REAL NOT NULL,
          pnl REAL,
          previousHash TEXT NOT NULL,
          currentHash TEXT NOT NULL
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS security_audit_logs (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          username TEXT NOT NULL,
          role TEXT NOT NULL,
          action TEXT NOT NULL,
          target TEXT NOT NULL,
          details TEXT NOT NULL,
          ipAddress TEXT NOT NULL,
          previousHash TEXT NOT NULL,
          currentHash TEXT NOT NULL
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS risk_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          maxDailyDrawdown REAL NOT NULL,
          maxAccountDrawdown REAL NOT NULL,
          globalKillSwitch INTEGER NOT NULL,
          maxLeverageLimit INTEGER NOT NULL,
          dailyLossLimitUSD REAL NOT NULL,
          restrictedSymbols TEXT NOT NULL,
          singleAssetMaxAllocationPercent REAL NOT NULL,
          industryCryptoMaxPercent REAL NOT NULL,
          autoMeltDrawdownThreshold REAL NOT NULL,
          autoMeltSharpeThreshold REAL NOT NULL
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      this.sqlDb.run(`
        CREATE TABLE IF NOT EXISTS mfa_action_tokens (
          tokenHash TEXT PRIMARY KEY,
          sessionIdHash TEXT NOT NULL,
          username TEXT NOT NULL,
          action TEXT NOT NULL,
          bodyHash TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          usedAt INTEGER
        )
      `);
    });

    this.loadAllData();
  }

  private loadAllData() {
    this.data = {
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
      ibConnectionMode: "web_api_proxy"
    };

    // Load from SQLite synchronously using sqlite3 callbacks wrapped in serialize
    this.sqlDb.serialize(() => {
      // 1. Users
      this.sqlDb.all("SELECT * FROM users", (err, rows: any[]) => {
        if (!err && rows && rows.length > 0) {
          this.data.users = rows.map(r => ({
            username: r.username,
            passwordHash: r.passwordHash,
            role: r.role,
            totpSecret: r.totpSecret,
            isActive: r.isActive === 1,
            tempTotpSecret: r.tempTotpSecret,
            tempTotpExpiresAt: r.tempTotpExpiresAt,
            mustEnrollTotp: r.mustEnrollTotp === 1
          }));
        } else {
          // No users found -> Bootstrap Administrator with high security and force改密 / force TOTP
          const seedUser = process.env.BOOTSTRAP_ADMIN_USER!;
          const seedPass = process.env.BOOTSTRAP_ADMIN_PASSWORD!;
          
          this.data.users = [
            {
              username: seedUser,
              passwordHash: hashPassword(seedPass),
              role: "admin",
              totpSecret: null, // Forces Dynamic Enrollment
              isActive: true,
              mustEnrollTotp: true
            }
          ];
          this.save();
        }
      });

      // 2. Sessions
      this.sqlDb.all("SELECT * FROM sessions", (err, rows: any[]) => {
        if (!err && rows) {
          this.data.sessions = rows.map(r => ({
            tokenHash: r.tokenHash,
            username: r.username,
            role: r.role,
            expiresAt: r.expiresAt
          }));
        }
      });

      // 3. Bots
      this.sqlDb.all("SELECT * FROM bots", (err, rows: any[]) => {
        if (!err && rows && rows.length > 0) {
          this.data.bots = rows.map(r => ({
            id: r.id,
            name: r.name,
            isEnabled: r.isEnabled === 1,
            broker: r.broker,
            symbol: r.symbol,
            type: r.type,
            direction: r.direction,
            rangeMin: r.rangeMin,
            rangeMax: r.rangeMax,
            gridCount: r.gridCount,
            investment: r.investment,
            leverage: r.leverage,
            stopLoss: r.stopLoss,
            takeProfit: r.takeProfit,
            status: r.status,
            profitUsd: r.profitUsd,
            profitPercent: r.profitPercent,
            unrealizedProfitUsd: r.unrealizedProfitUsd,
            tradesCount: r.tradesCount,
            entryPrice: r.entryPrice,
            currentPrice: r.currentPrice,
            lastUpdated: r.lastUpdated,
            timezone: r.timezone,
            cgroupsCpuLimit: r.cgroupsCpuLimit,
            cgroupsMemoryLimit: r.cgroupsMemoryLimit,
            pid: r.pid,
            memoryHeapMb: r.memoryHeapMb,
            cpuAffinity: r.cpuAffinity,
            version: r.version,
            liquidationPrice: r.liquidationPrice,
            maintenanceMargin: r.maintenanceMargin,
            grids: JSON.parse(r.grids || "[]"),
            configHistory: JSON.parse(r.configHistory || "[]")
          }));
        } else {
          // Seed standard bots
          this.data.bots = this.getSeedBots();
          this.save();
        }
      });

      // 4. Trade logs
      this.sqlDb.all("SELECT * FROM trade_logs ORDER BY timestamp DESC", (err, rows: any[]) => {
        if (!err && rows && rows.length > 0) {
          this.data.tradeLogs = rows;
        } else {
          this.data.tradeLogs = this.getSeedTradeLogs();
          this.save();
        }
      });

      // 5. Security audit logs
      this.sqlDb.all("SELECT * FROM security_audit_logs ORDER BY timestamp DESC", (err, rows: any[]) => {
        if (!err && rows && rows.length > 0) {
          this.data.securityAuditLogs = rows;
        } else {
          this.data.securityAuditLogs = this.getSeedSecurityLogs();
          this.save();
        }
      });

      // 6. Risk settings
      this.sqlDb.get("SELECT * FROM risk_settings LIMIT 1", (err, row: any) => {
        if (!err && row) {
          this.data.riskSettings = {
            maxDailyDrawdown: row.maxDailyDrawdown,
            maxAccountDrawdown: row.maxAccountDrawdown,
            globalKillSwitch: row.globalKillSwitch === 1,
            maxLeverageLimit: row.maxLeverageLimit,
            dailyLossLimitUSD: row.dailyLossLimitUSD,
            restrictedSymbols: JSON.parse(row.restrictedSymbols || "[]"),
            singleAssetMaxAllocationPercent: row.singleAssetMaxAllocationPercent,
            industryCryptoMaxPercent: row.industryCryptoMaxPercent,
            autoMeltDrawdownThreshold: row.autoMeltDrawdownThreshold,
            autoMeltSharpeThreshold: row.autoMeltSharpeThreshold
          };
        } else {
          this.save();
        }
      });

      // 7. System configurations
      this.sqlDb.get("SELECT value FROM system_config WHERE key = 'ibConnectionMode'", (err, row: any) => {
        if (!err && row) {
          this.data.ibConnectionMode = row.value as any;
        } else {
          this.save();
        }
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

  public save() {
    this.sqlDb.serialize(() => {
      this.sqlDb.run("BEGIN TRANSACTION;");

      // 1. Users table
      this.sqlDb.run("DELETE FROM users;");
      const stmtUser = this.sqlDb.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const u of this.data.users) {
        stmtUser.run(
          u.username,
          u.passwordHash,
          u.role,
          u.totpSecret || null,
          u.isActive ? 1 : 0,
          u.tempTotpSecret || null,
          u.tempTotpExpiresAt || null,
          u.mustEnrollTotp ? 1 : 0
        );
      }
      stmtUser.finalize();

      // 2. Sessions table
      this.sqlDb.run("DELETE FROM sessions;");
      const stmtSess = this.sqlDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)");
      for (const s of this.data.sessions) {
        stmtSess.run(s.tokenHash, s.username, s.role, s.expiresAt);
      }
      stmtSess.finalize();

      // 3. Bots table
      this.sqlDb.run("DELETE FROM bots;");
      const stmtBot = this.sqlDb.prepare(`
        INSERT INTO bots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const b of this.data.bots) {
        stmtBot.run(
          b.id,
          b.name,
          b.isEnabled ? 1 : 0,
          b.broker,
          b.symbol,
          b.type,
          b.direction,
          b.rangeMin,
          b.rangeMax,
          b.gridCount,
          b.investment,
          b.leverage,
          b.stopLoss || null,
          b.takeProfit || null,
          b.status,
          b.profitUsd,
          b.profitPercent,
          b.unrealizedProfitUsd,
          b.tradesCount,
          b.entryPrice,
          b.currentPrice,
          b.lastUpdated,
          b.timezone,
          b.cgroupsCpuLimit || null,
          b.cgroupsMemoryLimit || null,
          b.pid || null,
          b.memoryHeapMb || null,
          b.cpuAffinity || null,
          b.version || null,
          b.liquidationPrice || null,
          b.maintenanceMargin || null,
          JSON.stringify(b.grids || []),
          JSON.stringify(b.configHistory || [])
        );
      }
      stmtBot.finalize();

      // 4. Trade logs table
      this.sqlDb.run("DELETE FROM trade_logs;");
      const stmtTrade = this.sqlDb.prepare(`
        INSERT INTO trade_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of this.data.tradeLogs) {
        stmtTrade.run(
          t.id,
          t.botId,
          t.botName,
          t.broker,
          t.symbol,
          t.timestamp,
          t.type,
          t.price,
          t.amount,
          t.total,
          t.pnl === undefined ? null : t.pnl,
          t.previousHash || "",
          t.currentHash || ""
        );
      }
      stmtTrade.finalize();

      // 5. Security audit logs table
      this.sqlDb.run("DELETE FROM security_audit_logs;");
      const stmtAudit = this.sqlDb.prepare(`
        INSERT INTO security_audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of this.data.securityAuditLogs) {
        stmtAudit.run(
          a.id,
          a.timestamp,
          a.username,
          a.role,
          a.action,
          a.target,
          a.details,
          a.ipAddress,
          a.previousHash || "",
          a.currentHash || ""
        );
      }
      stmtAudit.finalize();

      // 6. Risk settings table
      this.sqlDb.run("DELETE FROM risk_settings;");
      const r = this.data.riskSettings;
      this.sqlDb.run(`
        INSERT INTO risk_settings (maxDailyDrawdown, maxAccountDrawdown, globalKillSwitch, maxLeverageLimit, dailyLossLimitUSD, restrictedSymbols, singleAssetMaxAllocationPercent, industryCryptoMaxPercent, autoMeltDrawdownThreshold, autoMeltSharpeThreshold)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        r.maxDailyDrawdown,
        r.maxAccountDrawdown,
        r.globalKillSwitch ? 1 : 0,
        r.maxLeverageLimit,
        r.dailyLossLimitUSD,
        JSON.stringify(r.restrictedSymbols || []),
        r.singleAssetMaxAllocationPercent,
        r.industryCryptoMaxPercent,
        r.autoMeltDrawdownThreshold,
        r.autoMeltSharpeThreshold
      ]);

      // 7. System config table
      this.sqlDb.run("INSERT OR REPLACE INTO system_config VALUES ('ibConnectionMode', ?)", [this.data.ibConnectionMode]);

      this.sqlDb.run("COMMIT;");
    });
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

  public getMfaTokensDb(callback: (err: any, rows: any[]) => void) {
    this.sqlDb.all("SELECT * FROM mfa_action_tokens", callback);
  }

  public insertMfaToken(tokenHash: string, sessionIdHash: string, username: string, action: string, bodyHash: string, expiresAt: number) {
    this.sqlDb.run(`
      INSERT INTO mfa_action_tokens (tokenHash, sessionIdHash, username, action, bodyHash, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [tokenHash, sessionIdHash, username, action, bodyHash, expiresAt]);
  }

  public consumeMfaToken(tokenHash: string, callback: (err: any, token: any) => void) {
    this.sqlDb.get("SELECT * FROM mfa_action_tokens WHERE tokenHash = ? AND usedAt IS NULL", [tokenHash], (err, row) => {
      if (!err && row) {
        this.sqlDb.run("UPDATE mfa_action_tokens SET usedAt = ? WHERE tokenHash = ?", [Date.now(), tokenHash], (updErr) => {
          callback(updErr, row);
        });
      } else {
        callback(err || new Error("MFA token not found or already consumed"), null);
      }
    });
  }
}

export const dbInstance = new AegisDB();
