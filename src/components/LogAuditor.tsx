import React, { useState, useEffect } from "react";
import { Download, Filter, RefreshCw, FileText } from "lucide-react";
import { TradeLog } from "../types";

export default function LogAuditor() {
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    broker: "ALL",
    symbol: "ALL",
    type: "ALL",
  });

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams(filters).toString();
      const res = await fetch(`/api/logs?${queryParams}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  const handleDownload = () => {
    // Initiate direct browser attachment download of standard trading logs CSV
    window.open("/api/logs/download", "_blank");
  };

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            System Execution Log Auditing
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
            Aegis Real-Time Journals
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            Active transaction stream cache. Extract dual-direction automated grid fills and broker clearance events.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 px-4 bg-[#0A0A0B] hover:bg-zinc-800 text-white hover:text-white rounded-none text-xs flex items-center gap-1.5 border border-[#2A2A2C] uppercase font-bold tracking-wider font-mono cursor-pointer transition-all h-10 w-full sm:w-auto justify-center"
            id="btn-refresh-logs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            REFRESH STREAM
          </button>
          <button
            onClick={handleDownload}
            className="p-2 px-5 bg-[#00FF66] hover:bg-[#00CC55] text-black rounded-none text-xs flex items-center gap-1.5 uppercase font-black tracking-wider transition-all cursor-pointer h-10 w-full sm:w-auto justify-center"
            id="btn-download-logs"
          >
            <Download className="h-3.5 w-3.5" />
            EXPORT TRANSACTION CSV
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]">
        <div>
          <label className="block text-[10px] text-[#666666] font-mono uppercase mb-1.5 font-bold">
            Broker Access Point
          </label>
          <select
            value={filters.broker}
            onChange={(e) => setFilters((prev) => ({ ...prev, broker: e.target.value }))}
            className="w-full bg-[#141416] text-white text-xs py-2 px-3 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-sans"
            id="filter-broker"
          >
            <option value="ALL">Show All Brokers (全部)</option>
            <option value="Binance">Binance Access Point</option>
            <option value="OKX">OKX Contract</option>
            <option value="Tiger">Tiger Securities (U.S.)</option>
            <option value="Longbridge">Longbridge Securities (H.K.)</option>
            <option value="IB">Interactive Brokers</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] font-mono uppercase mb-1.5 font-bold">
            Active Asset Pair
          </label>
          <select
            value={filters.symbol}
            onChange={(e) => setFilters((prev) => ({ ...prev, symbol: e.target.value }))}
            className="w-full bg-[#141416] text-white text-xs py-2 px-3 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono"
            id="filter-symbol"
          >
            <option value="ALL">All Asset Classes (全部)</option>
            <option value="BTC/USDT">BTC/USDT</option>
            <option value="ETH/USDT">ETH/USDT</option>
            <option value="NVDA">NVDA (NVIDIA)</option>
            <option value="TSLA">TSLA (TESLA)</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] font-mono uppercase mb-1.5 font-bold">
            Arbitrage Side
          </label>
          <select
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
            className="w-full bg-[#141416] text-white text-xs py-2 px-3 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono"
            id="filter-type"
          >
            <option value="ALL">All Tx Types (全部方向)</option>
            <option value="buy">BUY (买入对冲)</option>
            <option value="sell">SELL (卖出套利)</option>
          </select>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-[#2A2A2C] rounded-none bg-[#0A0A0B] text-[#666666]">
          <FileText className="h-8 w-8 mb-2 text-[#666666]" />
          <p className="text-xs uppercase font-mono font-bold">No matching journal outputs catalogued.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono" id="table-logs">
            <thead>
              <tr className="border-b border-[#2A2A2C] text-[9px] text-[#666666] font-mono tracking-wider uppercase bg-[#0A0A0B] font-bold">
                <th className="py-3 px-3">Transaction ID</th>
                <th className="py-3 px-3">Hedged Engine Profile</th>
                <th className="py-3 px-3">Access Point</th>
                <th className="py-3 px-3">Symbol Pair</th>
                <th className="py-3 px-3">Position Type</th>
                <th className="py-3 px-3 text-right font-bold">Match Price</th>
                <th className="py-3 px-3 text-right font-bold">Clear Size</th>
                <th className="py-3 px-3 text-right font-bold">Clear Value</th>
                <th className="py-3 px-3 text-right text-[#00FF66] font-bold">Realized PnL Profit</th>
                <th className="py-3 px-3 text-right font-bold">Cleared Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-[#2A2A2C] last:border-0 hover:bg-[#0A0A0B]/50 text-xs transition duration-150"
                >
                  <td className="py-3 px-3 text-zinc-500 font-mono text-[11px] truncate max-w-[80px]">
                    {log.id}
                  </td>
                  <td className="py-3 px-3 font-semibold text-[#E0E0E0] truncate max-w-[120px] uppercase text-[11px]">
                    {log.botName}
                  </td>
                  <td className="py-3 px-3">
                    <span className="bg-[#0A0A0B] px-2 py-0.5 rounded-none text-[9px] text-zinc-400 border border-[#2A2A2C] font-black uppercase">
                      {log.broker}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-white">
                    {log.symbol}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded-none text-[9px] font-black border uppercase ${
                        log.type === "buy"
                          ? "text-[#00FF66] border-[#00FF66] bg-emerald-950/20"
                          : "text-[#FF3333] border-[#FF3333] bg-rose-955/20"
                      }`}
                    >
                      {log.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-white">
                    ${log.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right text-[#E0E0E0]">
                    {log.amount.toFixed(4)}
                  </td>
                  <td className="py-3 px-3 text-right text-[#E0E0E0]">
                    ${log.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right text-[#00FF66] font-black italic">
                    {log.pnl && log.pnl > 0 ? `+$${log.pnl.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-3 px-3 text-right text-[10px] text-zinc-550">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
