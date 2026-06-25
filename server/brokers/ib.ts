import axios from "axios";
import https from "https";
import { BrokerAdapter, BrokerStatus, Balance, Position, OrderRequest, OrderAccepted, OrderStatus } from "./adapter";

export class InteractiveBrokersAdapter implements BrokerAdapter {
  private agent: https.Agent;

  constructor() {
    this.agent = new https.Agent({
      rejectUnauthorized: false // IB Client Portal typically runs on local loopback with self-signed certs
    });
  }

  private getBaseUrl(gatewayUrl?: string): string {
    return gatewayUrl || process.env.IB_GATEWAY_URL || "https://127.0.0.1:5000/v1/api";
  }

  async connect(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<BrokerStatus> {
    const baseUrl = this.getBaseUrl(apiKey); // In IB, apiKey is used to override gateway URL if needed
    try {
      const res = await axios.get(`${baseUrl}/one/user`, {
        httpsAgent: this.agent,
        timeout: 2000
      });
      if (res.status === 200 && res.data) {
        return { connected: true, username: res.data.username || "IB_USER" };
      }
      return { connected: false, error: "Authentication session not active on IB Client Portal." };
    } catch (err: any) {
      return { connected: false, error: `IB Gateway unreachable on ${baseUrl}: ${err.message}` };
    }
  }

  async getBalances(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Balance[]> {
    const baseUrl = this.getBaseUrl(apiKey);
    const res = await axios.get(`${baseUrl}/portfolio/accounts`, { httpsAgent: this.agent });
    const accounts = res.data || [];
    
    // Aggregate balances
    const balances: Balance[] = [];
    for (const acc of accounts) {
      if (acc.id) {
        balances.push({
          asset: `USD_${acc.id}`,
          free: parseFloat(acc.amount) || 0,
          locked: 0
        });
      }
    }
    return balances;
  }

  async getPositions(apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<Position[]> {
    const baseUrl = this.getBaseUrl(apiKey);
    const accountId = passphrase || process.env.IB_ACCOUNT_ID || "DU123456";
    const res = await axios.get(`${baseUrl}/portfolio/${accountId}/positions`, { httpsAgent: this.agent });
    const list = res.data || [];
    return list.map((p: any) => ({
      symbol: p.contractDesc || p.symbol,
      side: "long" as const,
      amount: parseFloat(p.position) || 0,
      entryPrice: parseFloat(p.mktPrice) || 0,
      unrealizedPnL: parseFloat(p.unrealizedPnl) || 0
    }));
  }

  async placeOrder(order: OrderRequest, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderAccepted> {
    const baseUrl = this.getBaseUrl(apiKey);
    const accountId = order.brokerAccountId || passphrase || process.env.IB_ACCOUNT_ID || "DU123456";
    
    try {
      // 1. Resolve contract ID (conid) from symbol search
      const encodedSymbol = encodeURIComponent(order.symbol.split("/")[0]);
      const searchRes = await axios.get(`${baseUrl}/iserver/secdef/search?symbol=${encodedSymbol}`, {
        httpsAgent: this.agent
      });
      const conid = searchRes.data?.[0]?.conid;
      if (!conid) {
        throw new Error(`Contract ID for symbol ${order.symbol} not resolved on Interactive Brokers.`);
      }

      // 2. Build order payload
      const orderPayload = {
        orders: [
          {
            conid,
            secType: order.secType || "STK",
            orderType: order.type === "LMT" ? "LMT" : "MKT",
            price: order.price,
            side: order.side.toUpperCase(),
            quantity: order.quantity,
            tif: "GTC",
            referrer: "AegisDB"
          }
        ]
      };

      // 3. Post order
      const res = await axios.post(`${baseUrl}/iserver/account/${accountId}/orders`, orderPayload, {
        httpsAgent: this.agent
      });

      let orderResult = res.data;
      
      // 4. Handle possible order confirmations (warnings / replies)
      if (Array.isArray(orderResult) && orderResult[0]?.id) {
        // IB Gateway often returns warning lists requiring confirmations
        const replyId = orderResult[0].id;
        console.log(`[IB Confirmation] Handling order confirmation prompt ${replyId}...`);
        const confirmRes = await axios.post(`${baseUrl}/iserver/reply/${replyId}`, { confirmed: true }, {
          httpsAgent: this.agent
        });
        orderResult = confirmRes.data;
      }

      const ordId = orderResult?.[0]?.order_id || `ib_order_${Math.floor(Math.random() * 1000000)}`;

      return {
        brokerOrderId: ordId,
        clientOrderId: order.clientOrderId,
        status: "NEW"
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message;
      return {
        brokerOrderId: "",
        clientOrderId: order.clientOrderId,
        status: "REJECTED",
        error: `Interactive Brokers execution failure: ${errMsg}`
      };
    }
  }

  async getOrder(orderId: string, symbol: string, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<OrderStatus> {
    const baseUrl = this.getBaseUrl(apiKey);
    const res = await axios.get(`${baseUrl}/iserver/account/orders`, { httpsAgent: this.agent });
    const ordersList = res.data?.orders || [];
    const found = ordersList.find((o: any) => String(o.orderId) === String(orderId));
    
    if (!found) {
      return {
        brokerOrderId: orderId,
        clientOrderId: "",
        status: "NEW"
      };
    }

    let finalStatus: OrderStatus["status"] = "NEW";
    if (found.status === "Filled") finalStatus = "FILLED";
    else if (found.status === "PreSubmitted" || found.status === "Submitted") finalStatus = "NEW";
    else if (found.status === "Cancelled") finalStatus = "CANCELED";
    else if (found.status === "Inactive") finalStatus = "REJECTED";

    return {
      brokerOrderId: orderId,
      clientOrderId: found.clientOrderId || "",
      status: finalStatus,
      filledPrice: parseFloat(found.avgPrice) || 0,
      filledQuantity: parseFloat(found.cumQty) || 0
    };
  }

  async cancelOrder(orderId: string, symbol: string, apiKey?: string, apiSecret?: string, passphrase?: string, isSandbox?: boolean): Promise<void> {
    const baseUrl = this.getBaseUrl(apiKey);
    const accountId = passphrase || process.env.IB_ACCOUNT_ID || "DU123456";
    await axios.delete(`${baseUrl}/iserver/account/${accountId}/order/${orderId}`, { httpsAgent: this.agent });
  }
}
