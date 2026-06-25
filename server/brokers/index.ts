import { BrokerAdapter } from "./adapter";
import { BinanceAdapter } from "./binance";
import { OKXAdapter } from "./okx";
import { LongbridgeAdapter } from "./longbridge";
import { TigerAdapter } from "./tiger";
import { InteractiveBrokersAdapter } from "./ib";

export * from "./adapter";
export * from "./binance";
export * from "./okx";
export * from "./longbridge";
export * from "./tiger";
export * from "./ib";

const adapters: Record<string, BrokerAdapter> = {
  "Binance": new BinanceAdapter(),
  "OKX": new OKXAdapter(),
  "Longbridge": new LongbridgeAdapter(),
  "Tiger": new TigerAdapter(),
  "IB": new InteractiveBrokersAdapter(),
  "Interactive Brokers": new InteractiveBrokersAdapter()
};

export function getBrokerAdapter(broker: string): BrokerAdapter | undefined {
  return adapters[broker];
}
