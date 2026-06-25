import crypto from "crypto";
import fs from "fs";
import path from "path";
import { BotConfig, TradeLog, RiskSettings, BrokerAccount, Order, Fill } from "../src/types";

// --- ENVIRONMENT INITIALIZATION & FAIL-FAST VALIDATION ---
const envPath = path.join(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  const adminUser = "admin";
  const adminPass = "Aegis_" + crypto.randomBytes(6).toString("hex") + "!";
  const encKey = crypto.randomBytes(32).toString("base64");
  const sessSec = crypto.randomBytes(32).toString("base64");

  const envContent = `# AegisQuant Secure Environment Configuration
BOOTSTRAP_ADMIN_USER=${adminUser}
BOOTSTRAP_ADMIN_PASSWORD=${adminPass}
ENCRYPTION_KEY=${encKey}
SESSION_SECRET=${sessSec}
`;
  fs.writeFileSync(envPath, envContent, "utf-8");
  console.log("==================================================================");
  console.log("  SECURE BOOTSTRAP: Created fresh .env with dynamic secrets.      ");
  console.log("  [NOTICE] Secure administrator credentials have been bootstrapped.");
  console.log("  To obtain your random admin password, check the .env file.      ");
  console.log("  TOTP setup will be forced upon first administrator login.       ");
  console.log("==================================================================");
}

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

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
}

const DB_DIR = path.join(process.cwd(), "data");

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
  public ready: Promise<void>;

  constructor() {
    this.ready = this.initDatabaseAsync();
  }

  private initDatabaseAsync(): Promise<void> {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    const JSON_FILE = path.join(DB_DIR, "aegis_secure.json");

    return new Promise<void>((resolve, reject) => {
      try {
        if (fs.existsSync(JSON_FILE)) {
          const raw = fs.readFileSync(JSON_FILE, "utf-8");
          this.data = JSON.parse(raw);
          if (!this.data.users) this.data.users = [];
          if (!this.data.sessions) this.data.sessions = [];
          if (!this.data.bots) this.data.bots = [];
          if (!this.data.tradeLogs) this.data.tradeLogs = [];
          if (!this.data.securityAuditLogs) this.data.securityAuditLogs = [];
          if (!this.data.brokerAccounts) this.data.brokerAccounts = [];
          if (!this.data.orders) this.data.orders = [];
          if (!this.data.fills) this.data.fills = [];
          if (!this.data.mfaActionTokens) this.data.mfaActionTokens = [];
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
        } else {
          const seedUser = process.env.BOOTSTRAP_ADMIN_USER!;
          const seedPass = process.env.BOOTSTRAP_ADMIN_PASSWORD!;
          this.data = {
            users: [
              {
                username: seedUser,
                passwordHash: hashPassword(seedPass),
                role: "admin",
                totpSecret: null,
                isActive: true,
                mustEnrollTotp: true
              }
            ],
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
            mfaActionTokens: []
          };
          this.save();
        }
        resolve();
      } catch (err) {
        reject(err);
      }
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
    const JSON_FILE = path.join(DB_DIR, "aegis_secure.json");
    try {
      fs.writeFileSync(JSON_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("Database save failed:", err);
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

  public insertOrder(ord: Order) {
    this.data.orders.unshift(ord);
    this.save();
  }

  public updateOrderStatus(clientOrderId: string, status: Order["status"], brokerOrderId?: string, lastError?: string) {
    const ord = this.data.orders.find(o => o.clientOrderId === clientOrderId);
    if (ord) {
      ord.status = status;
      if (brokerOrderId) ord.brokerOrderId = brokerOrderId;
      if (lastError) ord.lastError = lastError;
      ord.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  public insertFill(fill: Fill) {
    this.data.fills.unshift(fill);
    this.save();
  }

  public getMfaTokensDb(callback: (err: any, rows: any[]) => void) {
    callback(null, this.data.mfaActionTokens || []);
  }

  public insertMfaToken(tokenHash: string, sessionIdHash: string, username: string, action: string, bodyHash: string, expiresAt: number) {
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
  }

  public consumeMfaTokenAsync(
    tokenHash: string,
    username: string,
    sessionIdHash: string,
    action: string,
    bodyHash: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const now = Date.now();
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
    });
  }
}

export const dbInstance = new AegisDB();
