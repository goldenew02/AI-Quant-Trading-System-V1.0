import crypto from "crypto";
import { brokerHttp as axios, normalizeBrokerHttpError } from "./http";
import { BrokerAdapter, BrokerStatus, Balance, Position, OrderRequest, OrderAccepted, OrderStatus } from "./adapter";

export class OKXAdapter implements BrokerAdapter {
  supportsClientOrderIdLookup = true;

  private getHeaders(
    method: string,
    requestPath: string,
    body: string,
    apiKey: string,
    apiSecret: string,
    passphrase?: string,
    isSandbox?: boolean
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const signString = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
    const sign = crypto.createHmac("sha256", apiSecret).update(signString).digest("base64");

    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": passphrase || "",
      "Content-Type": "application/json"
    };

    if (isSandbox) {
      headers["x-simulated-auth"] = "1";
    }

    return headers;
  }

  private getBaseUrl(): string {
    return "https://www.okx.com";
  }

  async connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus> {
    if (!apiKey || !apiSecret) {
      return { connected: false, error: "OKX credentials not configured." };
    }
    try {
      const baseUrl = this.getBaseUrl();
      const requestPath = "/api/v5/account/config";
      const headers = this.getHeaders("GET", requestPath, "", apiKey, apiSecret, passphrase, isSandbox);
      
      const res = await axios.get(`${baseUrl}${requestPath}`, { headers, timeout: 5000 });
      if (res.data?.code === "0") {
        return { connected: true, username: `OKX_ACC_${res.data.data?.[0]?.uid || "USER"}` };
      }
      return { connected: false, error: res.data?.msg || "Verification failed" };
    } catch (err: any) {
      const errMsg = err.response?.data?.msg || err.message;
      return { connected: false, error: `OKX connectivity failed: ${errMsg}` };
    }
  }

  async getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    const requestPath = "/api/v5/account/balance";
    const headers = this.getHeaders("GET", requestPath, "", apiKey, apiSecret, passphrase, isSandbox);

    const res = await axios.get(`${baseUrl}${requestPath}`, { headers });
    if (res.data?.code !== "0") {
      throw new Error(`OKX Error: ${res.data?.msg}`);
    }

    const details = res.data.data?.[0]?.details || [];
    return details.map((d: any) => ({
      asset: d.ccy,
      free: parseFloat(d.availEq || d.cashBal || "0"),
      locked: parseFloat(d.frozenBal || "0")
    })).filter((b: any) => b.free > 0 || b.locked > 0);
  }

  async getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    const requestPath = "/api/v5/account/positions";
    const headers = this.getHeaders("GET", requestPath, "", apiKey, apiSecret, passphrase, isSandbox);

    const res = await axios.get(`${baseUrl}${requestPath}`, { headers });
    if (res.data?.code !== "0") {
      throw new Error(`OKX Error: ${res.data?.msg}`);
    }

    const positions = res.data.data || [];
    return positions.map((p: any) => ({
      symbol: p.instId,
      side: p.posSide === "net" ? "both" : p.posSide as any,
      amount: parseFloat(p.pos || "0"),
      entryPrice: parseFloat(p.avgPx || "0"),
      unrealizedPnL: parseFloat(p.upl || "0")
    })).filter((pos: any) => Math.abs(pos.amount) > 0);
  }

  async placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    const requestPath = "/api/v5/trade/order";
    
    // Format symbol: OKX uses BTC-USDT or BTC-USDT-SWAP, let's normalize
    let formattedInstId = order.symbol.replace("/", "-").toUpperCase();
    if (order.marketType === "perpetual" || order.marketType === "futures") {
      if (!formattedInstId.includes("SWAP")) {
        formattedInstId = `${formattedInstId}-SWAP`;
      }
    }

    const body = {
      instId: formattedInstId,
      tdMode: (order.marketType === "perpetual" || order.marketType === "futures") ? "cross" : "cash",
      clOrdId: order.clientOrderId,
      side: order.side.toLowerCase(),
      ordType: order.type.toLowerCase(),
      sz: String(order.quantity),
      ...(order.type === "LMT" ? { px: String(order.price) } : {})
    };

    const bodyStr = JSON.stringify(body);
    const headers = this.getHeaders("POST", requestPath, bodyStr, apiKey, apiSecret, passphrase, isSandbox);

    try {
      const res = await axios.post(`${baseUrl}${requestPath}`, body, { headers });
      const data = res.data;
      if (data?.code !== "0" || !data.data?.[0]) {
        return {
          brokerOrderId: "",
          clientOrderId: order.clientOrderId,
          status: "REJECTED",
          error: data?.msg || data?.data?.[0]?.sMsg || "Rejected by OKX"
        };
      }

      const ordDetails = data.data[0];
      return {
        brokerOrderId: ordDetails.ordId,
        clientOrderId: ordDetails.clOrdId,
        status: "NEW" // OKX placing order creates a working order
      };
    } catch (err: unknown) {
      const brokerErr = normalizeBrokerHttpError(err);
      const isRejected = brokerErr.type === "REJECTED" || brokerErr.type === "AUTH_FAILURE";
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: isRejected ? "REJECTED" : "UNKNOWN",
        error: `OKX transaction error (${brokerErr.type}): ${brokerErr.message}`
      };
    }
  }

  async getOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    let formattedInstId = symbol.replace("/", "-").toUpperCase();
    if (marketType === "perpetual" || marketType === "futures") {
      if (!formattedInstId.includes("SWAP")) {
        formattedInstId = `${formattedInstId}-SWAP`;
      }
    }
    const requestPath = `/api/v5/trade/order?ordId=${orderId}&instId=${formattedInstId}`;
    const headers = this.getHeaders("GET", requestPath, "", apiKey, apiSecret, passphrase, isSandbox);

    const res = await axios.get(`${baseUrl}${requestPath}`, { headers });
    if (res.data?.code !== "0" || !res.data.data?.[0]) {
      throw new Error(`OKX Order status request failed: ${res.data?.msg}`);
    }

    const orderInfo = res.data.data[0];
    let finalStatus: OrderStatus["status"] = "NEW";
    if (orderInfo.state === "filled") finalStatus = "FILLED";
    else if (orderInfo.state === "partially_filled") finalStatus = "PARTIALLY_FILLED";
    else if (orderInfo.state === "canceled") finalStatus = "CANCELED";

    return {
      brokerOrderId: orderInfo.ordId,
      clientOrderId: orderInfo.clOrdId,
      status: finalStatus,
      filledPrice: parseFloat(orderInfo.avgPx || "0"),
      filledQuantity: parseFloat(orderInfo.accFillSz || "0")
    };
  }

  async getOrderByClientOrderId(clientOrderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    let formattedInstId = symbol.replace("/", "-").toUpperCase();
    if (marketType === "perpetual" || marketType === "futures") {
      if (!formattedInstId.includes("SWAP")) {
        formattedInstId = `${formattedInstId}-SWAP`;
      }
    }
    const requestPath = `/api/v5/trade/order?clOrdId=${clientOrderId}&instId=${formattedInstId}`;
    const headers = this.getHeaders("GET", requestPath, "", apiKey, apiSecret, passphrase, isSandbox);

    const res = await axios.get(`${baseUrl}${requestPath}`, { headers });
    if (res.data?.code !== "0" || !res.data.data?.[0]) {
      throw new Error(`OKX Order status request failed by client order ID: ${res.data?.msg}`);
    }

    const orderInfo = res.data.data[0];
    let finalStatus: OrderStatus["status"] = "NEW";
    if (orderInfo.state === "filled") finalStatus = "FILLED";
    else if (orderInfo.state === "partially_filled") finalStatus = "PARTIALLY_FILLED";
    else if (orderInfo.state === "canceled") finalStatus = "CANCELED";

    return {
      brokerOrderId: orderInfo.ordId,
      clientOrderId: orderInfo.clOrdId || clientOrderId,
      status: finalStatus,
      filledPrice: parseFloat(orderInfo.avgPx || "0"),
      filledQuantity: parseFloat(orderInfo.accFillSz || "0")
    };
  }

  async cancelOrder(orderId: string, symbol: string, marketType: "spot" | "perpetual" | "futures", apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void> {
    if (!apiKey || !apiSecret) throw new Error("OKX credentials missing.");
    const baseUrl = this.getBaseUrl();
    const requestPath = "/api/v5/trade/cancel-order";
    let formattedInstId = symbol.replace("/", "-").toUpperCase();
    if (marketType === "perpetual" || marketType === "futures") {
      if (!formattedInstId.includes("SWAP")) {
        formattedInstId = `${formattedInstId}-SWAP`;
      }
    }
    
    const body = { ordId: orderId, instId: formattedInstId };
    const bodyStr = JSON.stringify(body);
    const headers = this.getHeaders("POST", requestPath, bodyStr, apiKey, apiSecret, passphrase, isSandbox);

    const res = await axios.post(`${baseUrl}${requestPath}`, body, { headers });
    if (res.data?.code !== "0") {
      throw new Error(`OKX Cancellation failed: ${res.data?.msg}`);
    }
  }
}
