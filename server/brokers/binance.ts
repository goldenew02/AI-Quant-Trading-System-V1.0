import crypto from "crypto";
import axios from "axios";
import { BrokerAdapter, BrokerStatus, Balance, Position, OrderRequest, OrderAccepted, OrderStatus } from "./adapter";

export class BinanceAdapter implements BrokerAdapter {
  private getBaseUrl(isSandbox?: boolean, isFutures?: boolean): string {
    if (isFutures) {
      return isSandbox 
        ? "https://testnet.binancefuture.com" 
        : "https://fapi.binance.com";
    }
    return isSandbox 
      ? "https://testnet.binancevision.com" 
      : "https://api.binance.com";
  }

  private buildSignedQuery(params: Record<string, any>, secret: string): string {
    const timestamp = Date.now();
    const queryObj = { ...params, timestamp };
    const queryStr = Object.keys(queryObj)
      .sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryObj[k])}`)
      .join("&");
    const signature = crypto.createHmac("sha256", secret).update(queryStr).digest("hex");
    return `${queryStr}&signature=${signature}`;
  }

  async connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus> {
    if (!apiKey || !apiSecret) {
      return { connected: false, error: "Binance credentials not configured." };
    }
    try {
      const baseUrl = this.getBaseUrl(isSandbox, false);
      const query = this.buildSignedQuery({}, apiSecret);
      const res = await axios.get(`${baseUrl}/api/v3/account?${query}`, {
        headers: { "X-MBX-APIKEY": apiKey },
        timeout: 5000
      });
      if (res.status === 200) {
        return { connected: true, username: `BINANCE_ACC_${res.data.accountType || "SPOT"}` };
      }
      return { connected: false, error: `Invalid response status: ${res.status}` };
    } catch (err: any) {
      // Try futures connectivity as a fallback if spot account is not active
      try {
        const futuresUrl = this.getBaseUrl(isSandbox, true);
        const query = this.buildSignedQuery({}, apiSecret);
        const res = await axios.get(`${futuresUrl}/fapi/v2/account?${query}`, {
          headers: { "X-MBX-APIKEY": apiKey },
          timeout: 5000
        });
        if (res.status === 200) {
          return { connected: true, username: `BINANCE_FUTURES` };
        }
      } catch (fErr: any) {
        return { connected: false, error: `Binance unreachable: ${err.message}. Futures also failed: ${fErr.message}` };
      }
      return { connected: false, error: `Binance auth failed: ${err.message}` };
    }
  }

  async getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]> {
    if (!apiKey || !apiSecret) throw new Error("Binance API keys are missing.");
    const baseUrl = this.getBaseUrl(isSandbox, false);
    const query = this.buildSignedQuery({}, apiSecret);
    const res = await axios.get(`${baseUrl}/api/v3/account?${query}`, {
      headers: { "X-MBX-APIKEY": apiKey }
    });
    const balances: any[] = res.data.balances || [];
    return balances
      .map(b => ({
        asset: b.asset,
        free: parseFloat(b.free) || 0,
        locked: parseFloat(b.locked) || 0
      }))
      .filter(b => b.free > 0 || b.locked > 0);
  }

  async getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]> {
    if (!apiKey || !apiSecret) throw new Error("Binance API keys are missing.");
    const baseUrl = this.getBaseUrl(isSandbox, true); // Positions typically refer to USD-M futures positions
    const query = this.buildSignedQuery({}, apiSecret);
    try {
      const res = await axios.get(`${baseUrl}/fapi/v2/positionRisk?${query}`, {
        headers: { "X-MBX-APIKEY": apiKey }
      });
      const rawPositions: any[] = res.data || [];
      return rawPositions
        .map(p => ({
          symbol: p.symbol,
          side: p.positionSide?.toLowerCase() === "long" ? "long" as const : p.positionSide?.toLowerCase() === "short" ? "short" as const : "both" as const,
          amount: parseFloat(p.positionAmt) || 0,
          entryPrice: parseFloat(p.entryPrice) || 0,
          unrealizedPnL: parseFloat(p.unRealizedProfit) || 0
        }))
        .filter(pos => Math.abs(pos.amount) > 0);
    } catch (e) {
      // Spot has no traditional positions; return empty list gracefully
      return [];
    }
  }

  async placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted> {
    if (!apiKey || !apiSecret) throw new Error("Binance credentials not provided.");
    
    const isFutures = order.marketType === "perpetual" || order.marketType === "futures";
    const baseUrl = this.getBaseUrl(isSandbox, isFutures);
    const formattedSymbol = order.symbol.replace("/", "").toUpperCase();

    const orderParams: Record<string, any> = {
      symbol: formattedSymbol,
      side: order.side.toUpperCase(),
      type: order.type === "LMT" ? "LIMIT" : "MARKET",
      quantity: order.quantity,
      newClientOrderId: order.clientOrderId
    };

    if (order.type === "LMT") {
      orderParams.price = order.price;
      orderParams.timeInForce = "GTC";
    }

    const query = this.buildSignedQuery(orderParams, apiSecret);
    const endpoint = isFutures ? "/fapi/v1/order" : "/api/v3/order";

    try {
      const res = await axios.post(`${baseUrl}${endpoint}?${query}`, {}, {
        headers: { "X-MBX-APIKEY": apiKey }
      });
      const data = res.data;
      
      let finalStatus: OrderAccepted["status"] = "NEW";
      if (data.status === "FILLED") {
        finalStatus = "FILLED";
      } else if (data.status === "PARTIALLY_FILLED") {
        finalStatus = "PARTIALLY_FILLED";
      } else if (data.status === "REJECTED" || data.status === "EXPIRED") {
        finalStatus = "REJECTED";
      }

      return {
        brokerOrderId: String(data.orderId),
        clientOrderId: data.clientOrderId,
        status: finalStatus,
        filledPrice: data.price ? parseFloat(data.price) : order.price,
        filledQuantity: data.executedQty ? parseFloat(data.executedQty) : 0
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.msg || err.message;
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: "REJECTED",
        error: `Binance transaction rejected: ${errMsg}`
      };
    }
  }

  async getOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    if (!apiKey || !apiSecret) throw new Error("Binance credentials missing.");
    const formattedSymbol = symbol.replace("/", "").toUpperCase();
    
    const isFutures = marketType === "perpetual" || marketType === "futures";
    const baseUrl = this.getBaseUrl(isSandbox, isFutures);
    const orderParams = { symbol: formattedSymbol, orderId };
    const query = this.buildSignedQuery(orderParams, apiSecret);
    const endpoint = isFutures ? "/fapi/v1/order" : "/api/v3/order";
    
    const res = await axios.get(`${baseUrl}${endpoint}?${query}`, {
      headers: { "X-MBX-APIKEY": apiKey }
    });
    
    let finalStatus: OrderStatus["status"] = "NEW";
    const data = res.data;
    if (data.status === "FILLED") finalStatus = "FILLED";
    else if (data.status === "PARTIALLY_FILLED") finalStatus = "PARTIALLY_FILLED";
    else if (data.status === "CANCELED") finalStatus = "CANCELED";
    else if (data.status === "REJECTED") finalStatus = "REJECTED";

    return {
      brokerOrderId: String(data.orderId),
      clientOrderId: data.clientOrderId,
      status: finalStatus,
      filledPrice: parseFloat(data.price || "0"),
      filledQuantity: parseFloat(data.executedQty || "0")
    };
  }

  async cancelOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void> {
    if (!apiKey || !apiSecret) throw new Error("Binance credentials missing.");
    const formattedSymbol = symbol.replace("/", "").toUpperCase();
    const isFutures = marketType === "perpetual" || marketType === "futures";
    const baseUrl = this.getBaseUrl(isSandbox, isFutures);
    const orderParams = { symbol: formattedSymbol, orderId };
    const query = this.buildSignedQuery(orderParams, apiSecret);
    const endpoint = isFutures ? "/fapi/v1/order" : "/api/v3/order";
    
    await axios.delete(`${baseUrl}${endpoint}?${query}`, {
      headers: { "X-MBX-APIKEY": apiKey }
    });
  }
}
