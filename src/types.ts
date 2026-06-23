export interface ApiKeyConfig {
  binance: { apiKey: string; secretKey: string; isSandbox: boolean };
  okx: { apiKey: string; secretKey: string; livePassphrase?: string; isSandbox: boolean };
  tiger: { accountId: string; privateKey: string; isSandbox: boolean };
  longbridge: { appKey: string; appSecret: string; accessToken: string; isSandbox: boolean };
  ib: { host: string; port: number; clientId: number; isSandbox: boolean };
}

export type BrokerType = 'Binance' | 'OKX' | 'Tiger' | 'Longbridge' | 'IB';
export type BotType = 'spot_grid' | 'futures_grid';
export type FuturesDirection = 'neutral' | 'long' | 'short';

export interface GridLine {
  price: number;
  type: 'buy' | 'sell';
  filled: boolean;
  amount: number;
}

export interface BotConfig {
  id: string; // "bot_1", "bot_2", "bot_3", "bot_4"
  name: string;
  isEnabled: boolean;
  broker: BrokerType;
  symbol: string; // e.g. "BTC/USDT", "ETH/USDT", "AAPL", "NVDA", "TSLA"
  type: BotType;
  direction: FuturesDirection;
  rangeMin: number;
  rangeMax: number;
  gridCount: number;
  investment: number;
  leverage: number; // 1-20x for futures_grid
  stopLoss?: number;
  takeProfit?: number;
  status: 'running' | 'paused' | 'stopped' | 'stopped_by_risk';
  profitUsd: number;
  profitPercent: number;
  unrealizedProfitUsd: number;
  tradesCount: number;
  grids: GridLine[];
  entryPrice: number;
  currentPrice: number;
  lastUpdated: string;
}

export interface TradeLog {
  id: string;
  botId: string;
  botName: string;
  broker: BrokerType;
  symbol: string;
  timestamp: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  total: number;
  pnl?: number; // realized PnL
}

export interface RiskSettings {
  maxDailyDrawdown: number; // in %
  maxAccountDrawdown: number; // in %
  globalKillSwitch: boolean;
  maxLeverageLimit: number; // e.g., 20
  dailyLossLimitUSD: number; // e.g., 1000
  restrictedSymbols: string[]; // comma separated symbols to disable
}

export interface systemOverview {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  uptime: string;
  ampereTemp: number; // simulated temperature on ARM
  coreStatus: 'Active' | 'Throttled' | 'Idle';
}
