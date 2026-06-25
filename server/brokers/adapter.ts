import { TradeLog } from "../../src/types";

export interface BrokerStatus {
  connected: boolean;
  username?: string;
  error?: string;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface Position {
  symbol: string;
  side: "long" | "short" | "both";
  amount: number;
  entryPrice: number;
  unrealizedPnL: number;
}

export interface OrderRequest {
  botId: string;
  brokerAccountId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LMT" | "MKT";
  price: number;
  quantity: number;
  secType?: string; // e.g. "STK" for IB
}

export interface OrderAccepted {
  brokerOrderId: string;
  clientOrderId: string;
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "REJECTED";
  filledPrice?: number;
  filledQuantity?: number;
  error?: string;
}

export interface OrderStatus {
  brokerOrderId: string;
  clientOrderId: string;
  status: "FILLED" | "PARTIALLY_FILLED" | "NEW" | "CANCELED" | "REJECTED";
  filledPrice?: number;
  filledQuantity?: number;
}

export interface BrokerAdapter {
  connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus>;
  getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]>;
  getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]>;
  placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted>;
  getOrder(orderId: string, symbol: string, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus>;
  cancelOrder(orderId: string, symbol: string, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void>;
}
