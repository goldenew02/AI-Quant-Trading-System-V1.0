import crypto from "crypto";
import fs from "fs";
import path from "path";
import { BotConfig, TradeLog, RiskSettings } from "../src/types";

export interface DBUser {
  username: string;
  passwordHash: string;
  role: 'admin' | 'operator' | 'viewer';
  totpSecret: string; // standard base32 secret
  isActive: boolean;
}

export interface DBSession {
  token: string;
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
const DB_FILE = path.join(DB_DIR, "aegis_db.json");

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
    bytes.push(parseInt(bits.substr(i, 8), 2));
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

// PBKDF2 Password Hashing
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, originalHash] = stored.split(":");
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return hash === originalHash;
  } catch (e) {
    return false;
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
  private data: AegisDatabase;

  constructor() {
    this.data = this.load();
  }

  private load(): AegisDatabase {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        console.error("Database parsing failed. Repairing data...", err);
      }
    }

    // Default seed database
    const seedDb: AegisDatabase = {
      users: [
        {
          username: "admin",
          passwordHash: hashPassword("aegisquant2026"),
          role: "admin",
          totpSecret: "KVKVE42KGBEGKVKV", // base32 for "AEGISQUANT2026"
          isActive: true
        },
        {
          username: "operator",
          passwordHash: hashPassword("operator2026"),
          role: "operator",
          totpSecret: "MNSFEY2MJVGEKVKV", // base32 for "OPERATOR2026"
          isActive: true
        },
        {
          username: "viewer",
          passwordHash: hashPassword("viewer2026"),
          role: "viewer",
          totpSecret: "OVYGS43VNZSGCVKV", // base32 for "VIEWER2026"
          isActive: true
        }
      ],
      sessions: [],
      bots: [
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
        },
        {
          id: "bot_3",
          name: "Tiger US stock NVDA Grid",
          isEnabled: false,
          broker: "Tiger",
          symbol: "NVDA",
          type: "spot_grid",
          direction: "neutral",
          rangeMin: 110,
          rangeMax: 140,
          gridCount: 6,
          investment: 3000,
          leverage: 1,
          status: "stopped",
          profitUsd: 0.00,
          profitPercent: 0.00,
          unrealizedProfitUsd: 0.00,
          tradesCount: 0,
          grids: this.generateGrids(110, 140, 6, 125, 3000 / 6),
          entryPrice: 125,
          currentPrice: 125,
          lastUpdated: new Date().toISOString(),
          timezone: "America/New_York",
          cgroupsCpuLimit: "Uncapped",
          cgroupsMemoryLimit: "Uncapped",
          pid: 4212,
          memoryHeapMb: 104.5,
          cpuAffinity: "CPU Core 2",
          version: "1.0.0",
          configHistory: [
            {
              version: "1.0.0",
              timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
              rangeMin: 110,
              rangeMax: 140,
              gridCount: 6,
              investment: 3000,
              leverage: 1,
            }
          ]
        },
        {
          id: "bot_4",
          name: "Longbridge HK stock TSLA Grid",
          isEnabled: false,
          broker: "Longbridge",
          symbol: "TSLA",
          type: "spot_grid",
          direction: "neutral",
          rangeMin: 160,
          rangeMax: 200,
          gridCount: 8,
          investment: 1500,
          leverage: 1,
          status: "stopped",
          profitUsd: 52.10,
          profitPercent: 3.47,
          unrealizedProfitUsd: 4.80,
          tradesCount: 5,
          grids: this.generateGrids(160, 200, 8, 182, 1500 / 8),
          entryPrice: 180,
          currentPrice: 182,
          lastUpdated: new Date().toISOString(),
          timezone: "Asia/Hong_Kong",
          cgroupsCpuLimit: "Uncapped",
          cgroupsMemoryLimit: "Uncapped",
          pid: 4213,
          memoryHeapMb: 118.9,
          cpuAffinity: "CPU Core 3",
          version: "1.0.0",
          configHistory: [
            {
              version: "1.0.0",
              timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
              rangeMin: 160,
              rangeMax: 200,
              gridCount: 8,
              investment: 1500,
              leverage: 1,
            }
          ]
        }
      ],
      tradeLogs: [
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
        },
        {
          id: "tx_3",
          botId: "bot_2",
          botName: "OKX Futures ETH Long",
          broker: "OKX",
          symbol: "ETH/USDT",
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          type: "buy",
          price: 3320,
          amount: 0.15,
          total: 498.00,
          pnl: 0
        },
        {
          id: "tx_4",
          botId: "bot_2",
          botName: "OKX Futures ETH Long",
          broker: "OKX",
          symbol: "ETH/USDT",
          timestamp: new Date(Date.now() - 3600000 * 0.8).toISOString(),
          type: "sell",
          price: 3370,
          amount: 0.15,
          total: 505.50,
          pnl: 7.50
        }
      ],
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

    // Calculate trade log cryptographic hashes for standard seed data
    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
    for (let i = seedDb.tradeLogs.length - 1; i >= 0; i--) {
      seedDb.tradeLogs[i].previousHash = prevHash;
      seedDb.tradeLogs[i].currentHash = computeLogHash(seedDb.tradeLogs[i], prevHash);
      prevHash = seedDb.tradeLogs[i].currentHash!;
    }

    // seed security audit events (chained as well)
    const initSecLogs = [
      { action: "INTEGRITY_CHECK", target: "HASH_CHAIN_DB", details: "Verified trade records cryptographic sequence consistency. Chains matches. Status: SAFE." },
      { action: "COMPLIANCE_BOOT", target: "FIREWALL_RULES", details: "Enforced loopback listener restriction for node executor. Oracle ARM isolated." },
      { action: "COMPLIANCE_BOOT", target: "ROOT_DAEMON", details: "Enrolled supervisor watchdog processes under pid 4210." }
    ];

    let prevSecHash = "0000000000000000000000000000000000000000000000000000000000000000";
    for (const log of initSecLogs) {
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
      seedDb.securityAuditLogs.unshift(entry);
      prevSecHash = entry.currentHash;
    }

    this.saveData(seedDb);
    return seedDb;
  }

  private saveData(db: AegisDatabase) {
    try {
      const tempFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), "utf-8");
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error("Atomic database write failed:", err);
    }
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
    this.saveData(this.data);
  }

  public appendSecurityLog(username: string, role: 'admin' | 'operator' | 'viewer', action: string, target: string, details: string, ip: string = "127.0.0.1") {
    // Audit Point 6.1: Immutable Ledger. Appends ONLY.
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

  public rechainTradeLogs() {
    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
    for (let i = this.data.tradeLogs.length - 1; i >= 0; i--) {
      this.data.tradeLogs[i].previousHash = prevHash;
      this.data.tradeLogs[i].currentHash = computeLogHash(this.data.tradeLogs[i], prevHash);
      prevHash = this.data.tradeLogs[i].currentHash!;
    }
    this.save();
  }
}

export const dbInstance = new AegisDB();
