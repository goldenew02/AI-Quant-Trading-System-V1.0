import { brokerHttp } from "../server/brokers/http";
import { BinanceAdapter } from "../server/brokers/binance";
import { OKXAdapter } from "../server/brokers/okx";
import { Order, BrokerAccount, BrokerType } from "../src/types";

const origPost = brokerHttp.post;
const origGet = brokerHttp.get;

async function run() {
  console.log("Running Broker Adapter Regression Tests...");
  let passed = 0;
  let failed = 0;

  const orderMock: Order = {
    id: "o1", botId: "b1", broker: "Binance" as BrokerType, brokerAccountId: "ba1",
    clientOrderId: "o1", symbol: "BTCUSDT", side: "BUY", type: "MKT", marketType: "spot",
    quantity: 1, price: 0, status: "PENDING", createdAt: Date.now().toString(), updatedAt: Date.now().toString()
  };

  const ba: any = {
    id: "ba1", name: "b", broker: "Binance", apiKey: "a", apiSecret: "s",
    isTestnet: true, capabilities: [], status: "ACTIVE", createdAt: 0, updatedAt: 0
  };

  const binance = new BinanceAdapter();
  
  // Test Binance -2010 -> REJECTED
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { code: -2010, msg: "New order rejected." }, status: 400 }
    });
  };
  let res = await binance.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "REJECTED") {
    passed++; console.log("[PASS] Binance -2010 -> REJECTED");
  } else {
    failed++; console.error("[FAIL] Binance -2010 ->", res.status);
  }

  // Test Binance timestamp -> UNKNOWN
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }, status: 400 }
    });
  };
  res = await binance.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") {
    passed++; console.log("[PASS] Binance timestamp (-1021) -> UNKNOWN");
  } else {
    failed++; console.error("[FAIL] Binance timestamp ->", res.status);
  }

  // Test Binance ECONNABORTED -> UNKNOWN
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true, code: "ECONNABORTED"
    });
  };
  res = await binance.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") {
    passed++; console.log("[PASS] Binance ECONNABORTED -> UNKNOWN");
  } else {
    failed++; console.error("[FAIL] Binance ECONNABORTED ->", res.status);
  }

  const okx = new OKXAdapter();

  // Test OKX Explicit Reject -> REJECTED
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { code: "51008", msg: "Order placing failed" }, status: 400 }
    });
  };
  res = await okx.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "REJECTED") {
    passed++; console.log("[PASS] OKX 51008 -> REJECTED");
  } else {
    failed++; console.error("[FAIL] OKX 51008 ->", res.status);
  }

  // Test OKX Network/Gateway error (50000) -> UNKNOWN
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { code: "50000", msg: "System error" }, status: 500 }
    });
  };
  res = await okx.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") {
    passed++; console.log("[PASS] OKX System Error (50000) -> UNKNOWN");
  } else {
    failed++; console.error("[FAIL] OKX System Error ->", res.status);
  }

  // Test IB explicit reject -> REJECTED
  const { InteractiveBrokersAdapter } = await import("../server/brokers/ib");
  const ib = new InteractiveBrokersAdapter();
  
  brokerHttp.get = async () => {
    return { data: [{ conid: "mock_conid" }] } as any;
  };
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { error: "Order rejected due to insufficient margin" }, status: 400 }
    });
  };
  res = await ib.placeOrder({ ...orderMock, marketType: "spot" }, "https://127.0.0.1:5000", "apiSecret", "accountId", true);
  if (res.status === "REJECTED") {
    passed++; console.log("[PASS] IB 'rejected' text -> REJECTED");
  } else {
    failed++; console.error("[FAIL] IB 'rejected' text ->", res.status);
  }

  // Test IB Client Portal offline -> UNKNOWN
  brokerHttp.post = async () => {
    throw Object.assign(new Error(), {
      isAxiosError: true,
      response: { data: { error: "Gateway timeout" }, status: 504 }
    });
  };
  res = await ib.placeOrder({ ...orderMock, marketType: "spot" }, "https://127.0.0.1:5000", "apiSecret", "accountId", true);
  if (res.status === "UNKNOWN") {
    passed++; console.log("[PASS] IB Gateway timeout -> UNKNOWN");
  } else {
    failed++; console.error("[FAIL] IB Gateway timeout ->", res.status);
  }

  // Test OKX 200 + code: 51008 -> REJECTED
  brokerHttp.post = async () => { return { status: 200, data: { code: "51008", msg: "Order placing failed" } } as any; };
  res = await okx.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "REJECTED") passed++; else failed++; console.log(res.status === "REJECTED" ? "[PASS]" : "[FAIL]", "OKX 200 + 51008 -> REJECTED");

  // Test OKX 200 + code: 50000 -> UNKNOWN
  brokerHttp.post = async () => { return { status: 200, data: { code: "50000", msg: "System error" } } as any; };
  res = await okx.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") passed++; else failed++; console.log(res.status === "UNKNOWN" ? "[PASS]" : "[FAIL]", "OKX 200 + 50000 -> UNKNOWN");

  // Test Tiger 200 + NO order_id + System error msg -> UNKNOWN
  const { TigerAdapter } = await import("../server/brokers/tiger");
  const tiger = new TigerAdapter();
  brokerHttp.post = async () => { return { status: 200, data: { message: "System busy" } } as any; };
  res = await tiger.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") passed++; else failed++; console.log(res.status === "UNKNOWN" ? "[PASS]" : "[FAIL]", "Tiger 200 + NO order_id + System error msg -> UNKNOWN");

  // Test Longbridge 200 + NO order_id + Gateway msg -> UNKNOWN
  const { LongbridgeAdapter } = await import("../server/brokers/longbridge");
  const longbridge = new LongbridgeAdapter();
  brokerHttp.post = async () => { return { status: 200, data: { message: "Gateway timeout" } } as any; };
  res = await longbridge.placeOrder(orderMock, "apiKey", "apiSecret", "", true);
  if (res.status === "UNKNOWN") passed++; else failed++; console.log(res.status === "UNKNOWN" ? "[PASS]" : "[FAIL]", "Longbridge 200 + NO order_id + Gateway msg -> UNKNOWN");

  // Restore mocks
  brokerHttp.post = origPost;
  brokerHttp.get = origGet;

  console.log(`Broker Adapter Tests Completed: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

try {
  run();
} catch (e) {
  brokerHttp.post = origPost;
  brokerHttp.get = origGet;
}
