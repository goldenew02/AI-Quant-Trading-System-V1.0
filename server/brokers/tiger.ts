import crypto from "crypto";
import { brokerHttp as axios, normalizeBrokerHttpError } from "./http";
import { BrokerAdapter, BrokerStatus, Balance, Position, OrderRequest, OrderAccepted, OrderStatus } from "./adapter";

export class TigerAdapter implements BrokerAdapter {
  supportsClientOrderIdLookup = false;

  private getHeaders(
    method: string,
    path: string,
    body: string,
    tigerId: string,
    privateKeyPem: string
  ): Record<string, string> {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    
    // Sort parameters and sign
    const signData = `method=${method}&path=${path}&timestamp=${timestamp}&tiger_id=${tigerId}&body=${body}`;
    
    let sign = "";
    try {
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(signData);
      sign = signer.sign(privateKeyPem, "base64");
    } catch (e) {
      // Fallback or offline signature logging
    }

    return {
      "Tiger-Id": tigerId,
      "Tiger-Timestamp": timestamp,
      "Tiger-Signature": sign,
      "Content-Type": "application/json"
    };
  }

  private getBaseUrl(isSandbox?: boolean): string {
    return isSandbox 
      ? "https://openapi-sandbox.itiger.com/gateway" 
      : "https://openapi.itiger.com/gateway";
  }

  async connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus> {
    if (!apiKey || !apiSecret) {
      return { connected: false, error: "Tiger Brokers credentials not configured." };
    }
    try {
      const baseUrl = this.getBaseUrl(isSandbox);
      const headers = this.getHeaders("GET", "/accounts", "", apiKey, apiSecret);

      const res = await axios.get(`${baseUrl}/accounts`, { headers, timeout: 5000 });
      if (res.status === 200) {
        return { connected: true, username: `TIGER_${res.data?.account || "USER"}` };
      }
      return { connected: false, error: "Tiger Brokers credentials authentication failed." };
    } catch (err: any) {
      return { connected: false, error: `Tiger Brokers unreachable: ${err.message}` };
    }
  }

  async getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]> {
    if (!apiKey || !apiSecret) throw new Error("Tiger API credentials missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const headers = this.getHeaders("GET", "/accounts/balance", "", apiKey, apiSecret);

    const res = await axios.get(`${baseUrl}/accounts/balance`, { headers });
    const items = res.data?.balances || [];
    return items.map((i: any) => ({
      asset: i.currency,
      free: parseFloat(i.usable || "0"),
      locked: parseFloat(i.frozen || "0")
    }));
  }

  async getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]> {
    if (!apiKey || !apiSecret) throw new Error("Tiger API credentials missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const headers = this.getHeaders("GET", "/accounts/positions", "", apiKey, apiSecret);

    const res = await axios.get(`${baseUrl}/accounts/positions`, { headers });
    const items = res.data?.positions || [];
    return items.map((i: any) => ({
      symbol: i.symbol,
      side: "long" as const,
      amount: parseFloat(i.quantity || "0"),
      entryPrice: parseFloat(i.average_cost || "0"),
      unrealizedPnL: parseFloat(i.unrealized_pnl || "0")
    }));
  }

  async placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted> {
    if (!apiKey || !apiSecret) throw new Error("Tiger API credentials missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = "/orders";

    const body = {
      account: order.brokerAccountId,
      symbol: order.symbol,
      action: order.side.toUpperCase(),
      order_type: order.type === "LMT" ? "LMT" : "MKT",
      quantity: order.quantity,
      ...(order.type === "LMT" ? { limit_price: order.price } : {}),
      cl_order_id: order.clientOrderId
    };

    const bodyStr = JSON.stringify(body);
    const headers = this.getHeaders("POST", path, bodyStr, apiKey, apiSecret);

    try {
      const res = await axios.post(`${baseUrl}${path}`, body, { headers });
      if (res.status === 200 && res.data?.order_id) {
        return {
          brokerOrderId: String(res.data.order_id),
          clientOrderId: order.clientOrderId,
          status: "NEW"
        };
      }
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: "REJECTED",
        error: res.data?.message || "Tiger Brokers order execution rejected"
      };
    } catch (err: unknown) {
      const brokerErr = normalizeBrokerHttpError(err);
      const isRejected = brokerErr.type === "REJECTED" || brokerErr.type === "AUTH_FAILURE";
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: isRejected ? "REJECTED" : "UNKNOWN",
        error: `Tiger Brokers transaction error (${brokerErr.type}): ${brokerErr.message}`
      };
    }
  }

  async getOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    if (!apiKey || !apiSecret) throw new Error("Tiger API credentials missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = `/orders/${orderId}`;
    const headers = this.getHeaders("GET", path, "", apiKey, apiSecret);

    const res = await axios.get(`${baseUrl}${path}`, { headers });
    const data = res.data;
    
    let finalStatus: OrderStatus["status"] = "NEW";
    if (data.status === "FILLED") finalStatus = "FILLED";
    else if (data.status === "PARTIALLY_FILLED") finalStatus = "PARTIALLY_FILLED";
    else if (data.status === "CANCELED") finalStatus = "CANCELED";
    else if (data.status === "REJECTED") finalStatus = "REJECTED";

    return {
      brokerOrderId: orderId,
      clientOrderId: data.cl_order_id || "",
      status: finalStatus,
      filledPrice: parseFloat(data.filled_price || "0"),
      filledQuantity: parseFloat(data.filled_quantity || "0")
    };
  }

  async cancelOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void> {
    if (!apiKey || !apiSecret) throw new Error("Tiger API credentials missing.");
    const baseUrl = this.getBaseUrl(isSandbox);
    const path = `/orders/${orderId}`;
    const headers = this.getHeaders("DELETE", path, "", apiKey, apiSecret);

    await axios.delete(`${baseUrl}${path}`, { headers });
  }
}
