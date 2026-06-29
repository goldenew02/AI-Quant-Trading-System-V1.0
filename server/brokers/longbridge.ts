import crypto from "crypto";
import axios from "axios";
import { BrokerAdapter, BrokerStatus, Balance, Position, OrderRequest, OrderAccepted, OrderStatus } from "./adapter";

export class LongbridgeAdapter implements BrokerAdapter {
  private getHeaders(
    method: string,
    path: string,
    body: string,
    appKey: string,
    appSecret: string,
    isSandbox?: boolean
  ): Record<string, string> {
    const timestamp = String(Date.now());
    const signatureRaw = `${timestamp}${method.toUpperCase()}${path}${body}`;
    const signature = crypto.createHmac("sha256", appSecret).update(signatureRaw).digest("hex");

    return {
      "X-App-Key": appKey,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "Content-Type": "application/json"
    };
  }

  private getBaseUrl(isSandbox?: boolean): string {
    return isSandbox 
      ? "https://openapi.sandbox.longbridgeapp.com" 
      : "https://openapi.longbridgeapp.com";
  }

  async connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus> {
    if (!apiKey || !apiSecret) {
      return { connected: false, error: "Longbridge credentials not configured." };
    }
    try {
      const baseUrl = this.getBaseUrl(isSandbox);
      const path = "/v1/account/info";
      const headers = this.getHeaders("GET", path, "", apiKey, apiSecret, isSandbox);

      const res = await axios.get(`${baseUrl}${path}`, { headers, timeout: 5000 });
      if (res.status === 200) {
        return { connected: true, username: `LONGBRIDGE_${res.data?.account_no || "USER"}` };
      }
      return { connected: false, error: "Authentication failed on Longbridge OpenAPI" };
    } catch (err: any) {
      return { connected: false, error: `Longbridge unreachable: ${err.message}` };
    }
  }

  async getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]> {
    if (!apiKey || !apiSecret) throw new Error("Longbridge API keys missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = "/v1/asset/balance";
    const headers = this.getHeaders("GET", path, "", apiKey, apiSecret, isSandbox);

    const res = await axios.get(`${baseUrl}${path}`, { headers });
    const cash = res.data?.cash_infos || [];
    return cash.map((c: any) => ({
      asset: c.currency,
      free: parseFloat(c.usable_cash || "0"),
      locked: parseFloat(c.frozen_cash || "0")
    }));
  }

  async getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]> {
    if (!apiKey || !apiSecret) throw new Error("Longbridge API keys missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = "/v1/asset/position";
    const headers = this.getHeaders("GET", path, "", apiKey, apiSecret, isSandbox);

    const res = await axios.get(`${baseUrl}${path}`, { headers });
    const positions = res.data?.positions || [];
    return positions.map((p: any) => ({
      symbol: p.symbol,
      side: "long" as const,
      amount: parseFloat(p.quantity || "0"),
      entryPrice: parseFloat(p.cost_price || "0"),
      unrealizedPnL: parseFloat(p.unrealized_pnl || "0")
    }));
  }

  async placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted> {
    if (!apiKey || !apiSecret) throw new Error("Longbridge API keys missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = "/v1/trade/order";

    const body = {
      symbol: order.symbol.replace("/", ".").toUpperCase(), // Longbridge symbol format AAPL.US
      side: order.side === "BUY" ? "Buy" : "Sell",
      order_type: order.type === "LMT" ? "LO" : "MO", // LO is limit, MO is market
      submitted_quantity: String(order.quantity),
      ...(order.type === "LMT" ? { submitted_price: String(order.price) } : {}),
      time_in_force: "Day"
    };

    const bodyStr = JSON.stringify(body);
    const headers = this.getHeaders("POST", path, bodyStr, apiKey, apiSecret, isSandbox);

    try {
      const res = await axios.post(`${baseUrl}${path}`, body, { headers });
      if (res.status === 200 && res.data?.order_id) {
        return {
          brokerOrderId: res.data.order_id,
          clientOrderId: order.clientOrderId,
          status: "NEW"
        };
      }
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: "REJECTED",
        error: res.data?.message || "Order rejected by Longbridge"
      };
    } catch (err: any) {
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: "REJECTED",
        error: `Longbridge request failure: ${err.message}`
      };
    }
  }

  async getOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    if (!apiKey || !apiSecret) throw new Error("Longbridge API keys missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = `/v1/trade/order?order_id=${orderId}`;
    const headers = this.getHeaders("GET", path, "", apiKey, apiSecret, isSandbox);

    const res = await axios.get(`${baseUrl}${path}`, { headers });
    const details = res.data;
    
    let finalStatus: OrderStatus["status"] = "NEW";
    if (details.status === "Filled") finalStatus = "FILLED";
    else if (details.status === "PartiallyFilled") finalStatus = "PARTIALLY_FILLED";
    else if (details.status === "Cancelled") finalStatus = "CANCELED";
    else if (details.status === "Rejected") finalStatus = "REJECTED";

    return {
      brokerOrderId: orderId,
      clientOrderId: details.client_order_id || "",
      status: finalStatus,
      filledPrice: parseFloat(details.executed_price || "0"),
      filledQuantity: parseFloat(details.executed_quantity || "0")
    };
  }

  async cancelOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void> {
    if (!apiKey || !apiSecret) throw new Error("Longbridge API keys missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = `/v1/trade/order?order_id=${orderId}`;
    const headers = this.getHeaders("DELETE", path, "", apiKey, apiSecret, isSandbox);

    await axios.delete(`${baseUrl}${path}`, { headers });
  }
}
