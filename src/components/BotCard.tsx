import React, { useState } from "react";
import { Play, Square, Settings, RefreshCw, Layers, ShieldAlert, Coins, HelpCircle } from "lucide-react";
import { BotConfig, BrokerType, BotType, FuturesDirection } from "../types";

interface BotCardProps {
  key?: string;
  bot: BotConfig;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onConfigure: (id: string, config: any) => void;
}

export default function BotCard({ bot, onStart, onStop, onConfigure }: BotCardProps) {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [rollingId, setRollingId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState({
    name: bot.name,
    broker: bot.broker,
    symbol: bot.symbol,
    type: bot.type,
    direction: bot.direction,
    rangeMin: bot.rangeMin,
    rangeMax: bot.rangeMax,
    gridCount: bot.gridCount,
    investment: bot.investment,
    leverage: bot.leverage,
    stopLoss: bot.stopLoss || 0,
    takeProfit: bot.takeProfit || 0,
    timezone: bot.timezone || "UTC",
    cpuAffinity: bot.cpuAffinity || "CPU Core 0",
    cgroupsCpuLimit: bot.cgroupsCpuLimit || "Uncapped",
    cgroupsMemoryLimit: bot.cgroupsMemoryLimit || "Uncapped",
  });

  const handleSave = () => {
    onConfigure(bot.id, {
      ...editingConfig,
      rangeMin: Number(editingConfig.rangeMin),
      rangeMax: Number(editingConfig.rangeMax),
      gridCount: Number(editingConfig.gridCount),
      investment: Number(editingConfig.investment),
      leverage: Number(editingConfig.leverage),
      stopLoss: editingConfig.stopLoss ? Number(editingConfig.stopLoss) : undefined,
      takeProfit: editingConfig.takeProfit ? Number(editingConfig.takeProfit) : undefined,
    });
    setIsConfiguring(false);
  };

  const handleRollback = async (version: string) => {
    try {
      setRollingId(version);
      const res = await fetch(`/api/bots/rollback/${bot.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version })
      });
      if (res.ok) {
        const data = await res.json();
        onConfigure(bot.id, data.bot);
        setShowHistory(false);
        alert(`成功：网格机器人已回滚至配置版本 ${version}！`);
      } else {
        const data = await res.json();
        alert(data.error || "回滚失败");
      }
    } catch (err) {
      console.error(err);
      alert("回滚参数通讯故障，请重试");
    } finally {
      setRollingId(null);
    }
  };

  const handleValueChange = (field: string, value: any) => {
    setEditingConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const getStatusColorClass = (status: string) => {
    switch (status) {
      case "running":
        return "bg-[#00FF66] text-black font-black";
      case "stopped_by_risk":
        return "bg-[#FF3333] text-white font-black";
      default:
        return "bg-neutral-800 text-neutral-400 font-bold";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "running":
        return "RUNNING (7*24H)";
      case "stopped_by_risk":
        return "LIQUID RISK CUTOFF";
      default:
        return "STANDBY / SUSPENDED";
    }
  };

  return (
    <div
      className={`border p-6 text-[#E0E0E0] shadow-none rounded-none transition-all duration-300 flex flex-col justify-between ${
        bot.status === "running"
          ? "bg-[#141416] border-[#00FF66]"
          : "bg-[#141416]/90 border-[#2A2A2C]"
      }`}
      id={`bot-card-${bot.id}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span
              className={`text-[10px] tracking-widest px-2 py-0.5 uppercase ${getStatusColorClass(
                bot.status
              )}`}
            >
              {bot.status === "running" ? "ACTIVE" : bot.status === "stopped_by_risk" ? "RISK" : "OFFLINE"}
            </span>
            <h3 className="text-sm uppercase tracking-wider font-bold text-white font-mono">{bot.name}</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center text-[10px] text-zinc-500 font-mono uppercase">
            <span>Broker:</span>
            <span className="text-white border border-[#2A2A2C] bg-[#0A0A0B] px-1.5 py-0.2 rounded-none">
              {bot.broker}
            </span>
            <span className="text-zinc-650">|</span>
            <span>Asset:</span>
            <span className="text-[#00FF66] font-bold">{bot.symbol}</span>
          </div>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => setIsConfiguring(!isConfiguring)}
            disabled={bot.status === "running" || showHistory}
            className="border border-white/20 select-none text-white hover:border-white/50 text-[10px] font-bold py-2 px-2.5 uppercase rounded-none transition tracking-wider flex items-center gap-1.5 cursor-pointer disabled:opacity-20"
            title="策略配置"
            id={`btn-configure-${bot.id}`}
          >
            <Settings className="h-3 w-3" />
            Config
          </button>

          <button
            onClick={() => setShowHistory(!showHistory)}
            disabled={isConfiguring}
            className="border border-white/20 select-none text-zinc-400 hover:text-white hover:border-white/50 text-[10px] font-bold py-2 px-2.5 uppercase rounded-none transition tracking-wider flex items-center gap-1.5 cursor-pointer disabled:opacity-20"
            title="配置版本历史"
            id={`btn-history-${bot.id}`}
          >
            <Layers className="h-3 w-3 text-[#6FF]" />
            History
          </button>

          {bot.status === "running" ? (
            <button
              onClick={() => onStop(bot.id)}
              className="bg-[#FF3333] hover:bg-[#CC2222] text-white text-[10px] font-bold py-2 px-3 uppercase rounded-none tracking-wider transition flex items-center gap-1.5 cursor-pointer"
              id={`btn-stop-${bot.id}`}
            >
              <Square className="h-3 w-3 fill-white" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => onStart(bot.id)}
              className="bg-[#00FF66] hover:bg-[#00CC55] text-black text-[10px] font-bold py-2 px-3 uppercase rounded-none tracking-wider transition flex items-center gap-1.5 cursor-pointer"
              id={`btn-start-${bot.id}`}
            >
              <Play className="h-3 w-3 fill-black" />
              Start
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] text-xs mt-4 rounded-none mb-4" id={`history-panel-${bot.id}`}>
          <h4 className="font-bold text-[#E0E0E0] pb-2 border-b border-[#2A2A2C] mb-2 font-mono uppercase tracking-wider flex justify-between items-center text-[10px]">
            <span>Version History Archive (参数历史)</span>
            <span className="text-[8px] bg-zinc-800 text-[#6FF] px-1.5 py-0.5 font-bold">ROLLBACK CONTROL</span>
          </h4>
          {bot.configHistory && bot.configHistory.length > 0 ? (
            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
              {[...bot.configHistory].reverse().map((ver) => (
                <div key={ver.version} className="bg-[#141416] p-2 border border-[#2A2A2C] flex justify-between items-center font-mono">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#6FF] font-black">v{ver.version}</span>
                      <span className="text-[8px] text-[#666666]">{new Date(ver.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[9px] text-zinc-400 mt-0.5">
                      R: ${ver.rangeMin}-${ver.rangeMax} | G: {ver.gridCount} | Lev: {ver.leverage}x | Inv: ${ver.investment}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRollback(ver.version)}
                    disabled={rollingId === ver.version || bot.version === ver.version || bot.status === "running"}
                    className="bg-[#2A2A2C] hover:bg-[#6FF] hover:text-black disabled:opacity-20 text-white text-[8px] font-bold py-1 px-2 rounded-none uppercase transition cursor-pointer"
                  >
                    {bot.version === ver.version ? "CURRENT" : "RESTORE"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-zinc-550 font-mono uppercase">No configuration versions logged.</p>
          )}
        </div>
      )}

      {isConfiguring ? (
        <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] text-xs gap-3 flex flex-col mt-4 rounded-none" id={`config-panel-${bot.id}`}>
          <h4 className="font-bold text-[#E0E0E0] pb-2 border-b border-[#2A2A2C] mb-1 font-mono uppercase tracking-wider">
            PARAMETERS MODULATION SELECTOR
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Bot Name</label>
              <input
                type="text"
                value={editingConfig.name}
                onChange={(e) => handleValueChange("name", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Broker Access API</label>
              <select
                value={editingConfig.broker}
                onChange={(e) => handleValueChange("broker", e.target.value as BrokerType)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="Binance">Binance Sandbox</option>
                <option value="OKX">OKX Sandbox</option>
                <option value="Tiger">Tiger Broker</option>
                <option value="Longbridge">Longbridge API</option>
                <option value="IB">Interactive Brokers</option>
              </select>
            </div>

            <div>
              <label className="block text:[10px] text-zinc-500 uppercase font-mono mb-1">Symbol pair</label>
              <input
                type="text"
                value={editingConfig.symbol}
                onChange={(e) => handleValueChange("symbol", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Grid Profile Type</label>
              <select
                value={editingConfig.type}
                onChange={(e) => handleValueChange("type", e.target.value as BotType)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="spot_grid">Spot Grid (现货普通)</option>
                <option value="futures_grid">Leveraged Futures (衍生合约)</option>
              </select>
            </div>

            {editingConfig.type === "futures_grid" && (
              <>
                <div>
                  <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Contract Direction</label>
                  <select
                    value={editingConfig.direction}
                    onChange={(e) => handleValueChange("direction", e.target.value as FuturesDirection)}
                    className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
                  >
                    <option value="neutral">Neutral Double (中立)</option>
                    <option value="long">Bull Long (做多)</option>
                    <option value="short">Bear Short (做空)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Multiplier Leverage</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={editingConfig.leverage}
                    onChange={(e) => handleValueChange("leverage", parseInt(e.target.value))}
                    className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Lower Price Bound</label>
              <input
                type="number"
                value={editingConfig.rangeMin}
                onChange={(e) => handleValueChange("rangeMin", parseFloat(e.target.value))}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Upper Price Bound</label>
              <input
                type="number"
                value={editingConfig.rangeMax}
                onChange={(e) => handleValueChange("rangeMax", parseFloat(e.target.value))}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Total Grid count</label>
              <input
                type="number"
                min="3"
                max="50"
                value={editingConfig.gridCount}
                onChange={(e) => handleValueChange("gridCount", parseInt(e.target.value))}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Principal Capital (USD)</label>
              <input
                type="number"
                value={editingConfig.investment}
                onChange={(e) => handleValueChange("investment", parseFloat(e.target.value))}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Stop Loss Line (USD)</label>
              <input
                type="number"
                value={editingConfig.stopLoss || ""}
                onChange={(e) => handleValueChange("stopLoss", e.target.value ? parseFloat(e.target.value) : 0)}
                placeholder="Optional"
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Take Profit Line (USD)</label>
              <input
                type="number"
                value={editingConfig.takeProfit || ""}
                onChange={(e) => handleValueChange("takeProfit", e.target.value ? parseFloat(e.target.value) : 0)}
                placeholder="Optional"
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-mono focus:border-[#00FF66] focus:outline-none"
              />
            </div>

            <div className="col-span-2 border-t border-[#2A2A2C]/60 pt-2.5 mt-1.5">
              <span className="text-[9px] text-[#6FF] uppercase font-mono font-bold tracking-wider">Aegis Sandbox Isolation Controls</span>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">CPU Affinity Pinning</label>
              <select
                value={editingConfig.cpuAffinity}
                onChange={(e) => handleValueChange("cpuAffinity", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="CPU Core 0">CPU Core 0 Only</option>
                <option value="CPU Core 1">CPU Core 1 Only</option>
                <option value="Shared Cores">Shared Cores 0 + 1</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">cgroups CPU Limit</label>
              <select
                value={editingConfig.cgroupsCpuLimit}
                onChange={(e) => handleValueChange("cgroupsCpuLimit", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="Uncapped">Uncapped (Shared)</option>
                <option value="Max 30% CPU">Max 30% CPU Quota</option>
                <option value="Max 50% CPU">Max 50% CPU Quota</option>
                <option value="Max 75% CPU">Max 75% CPU Quota</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">cgroups Memory Limit</label>
              <select
                value={editingConfig.cgroupsMemoryLimit}
                onChange={(e) => handleValueChange("cgroupsMemoryLimit", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="Uncapped">Uncapped (Shared)</option>
                <option value="Max 1G RAM">Max 1G RAM Cap</option>
                <option value="Max 3G RAM">Max 3G RAM Cap</option>
                <option value="Max 6G RAM">Max 6G RAM Cap</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">Market Timezone</label>
              <select
                value={editingConfig.timezone}
                onChange={(e) => handleValueChange("timezone", e.target.value)}
                className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-1.5 px-2.5 text-white text-xs font-sans focus:border-[#00FF66] focus:outline-none"
              >
                <option value="UTC">UTC (Cryptocurrencies)</option>
                <option value="America/New_York">EST (New York Stocks)</option>
                <option value="Asia/Tokyo">JST (Tokyo Securities)</option>
                <option value="Asia/Hong_Kong">HKT (Hong Kong Longbridge)</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-3">
            <button
              onClick={() => setIsConfiguring(false)}
              className="border border-white/20 hover:border-white/50 text-[#666666] hover:text-white text-[10px] font-bold py-2 px-4 uppercase rounded-none transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="bg-white text-black text-[10px] font-bold py-2 px-4 uppercase rounded-none transition hover:bg-[#00FF66] cursor-pointer"
            >
              Apply Modulation
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] flex flex-col justify-between">
              <span className="text-[9px] text-[#666666] uppercase tracking-wider font-mono">Realized Arbitrage Profit</span>
              <div className="mt-2">
                <div className={`text-2xl font-black font-display tracking-tighter italic ${bot.profitPercent >= 0 ? "text-[#00FF66]" : "text-[#FF3333]"}`}>
                  {bot.profitPercent >= 0 ? "+" : ""}{bot.profitPercent.toFixed(2)}%
                </div>
                <div className="text-[11px] font-mono text-[#E0E0E0] mt-0.5">
                  +${bot.profitUsd.toFixed(2)} Usd
                </div>
              </div>
            </div>

            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] flex flex-col justify-between">
              <span className="text-[9px] text-[#666666] uppercase tracking-wider font-mono">Unrealized Delta Exposure</span>
              <div className="mt-2">
                <div className={`text-2xl font-black font-display tracking-tighter italic ${
                  bot.unrealizedProfitUsd >= 0 ? "text-[#00FF66]" : "text-[#FF3333]"
                }`}>
                  {bot.unrealizedProfitUsd >= 0 ? "+" : ""}${bot.unrealizedProfitUsd.toFixed(2)}
                </div>
                <div className="text-[9px] text-zinc-500 tracking-tight font-mono mt-1">
                  Active position drift
                </div>
              </div>
            </div>
          </div>

          {/* Details list */}
          <div className="space-y-2 border-t border-[#2A2A2C] pt-4 text-xs text-[#E0E0E0] font-mono">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#666666] uppercase tracking-wider text-[9px]">Execution Range</span>
              <span className="font-bold">
                ${bot.rangeMin.toLocaleString()} - ${bot.rangeMax.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#666666] uppercase tracking-wider text-[9px]">Grids / Leverage</span>
              <span>
                {bot.gridCount} Layers{" "}
                {bot.type === "futures_grid" ? `| MULTI ${bot.leverage}X (${bot.direction.toUpperCase()})` : "| SPOT RAW"}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#666666] uppercase tracking-wider text-[9px]">Capital / Spot Tick</span>
              <div className="space-x-1.5">
                <span className="text-[#6FF] font-bold">${bot.investment.toLocaleString()}</span>
                <span className="text-[#666666]">/</span>
                <span className="text-[#00FF66] font-bold">${bot.currentPrice.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#666666] uppercase tracking-wider text-[9px]">Uptime Cycle</span>
              <div className="space-x-1 flex items-center">
                <span className="inline-block w-1.5 h-1.5 bg-[#00FF66] animate-pulse"></span>
                <span className="text-[#E0E0E0] font-mono uppercase text-[10px] tracking-tight">{getStatusLabel(bot.status)}</span>
                <span className="text-[#666666]">({bot.tradesCount} Tx)</span>
              </div>
            </div>

            {/* Futures specific liquidation & margin indicators */}
            {bot.type === "futures_grid" && (
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-[#2A2A2C]/40 text-[10px]">
                <div className="bg-rose-950/20 border border-rose-900/30 p-2 rounded-none">
                  <span className="text-[8px] text-[#FF3333] uppercase block font-bold">EST. LIQUIDATION PRICE</span>
                  <span className="text-white font-black block mt-0.5">${bot.liquidationPrice?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="bg-amber-950/20 border border-amber-900/30 p-2 rounded-none">
                  <span className="text-[8px] text-amber-500 block font-bold">MAINTENANCE MARGIN</span>
                  <span className="text-white font-black block mt-0.5">${bot.maintenanceMargin?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}

            {/* Process Isolation Sandbox Bar */}
            <div className="bg-[#0A0A0B] p-2 border border-[#2A2A2C] flex flex-col gap-1 text-[9px] text-zinc-500 font-mono mt-3 uppercase">
              <div className="flex justify-between items-center border-b border-[#2A2A2C]/40 pb-1">
                <span>PID: <span className="text-[#00FF66] font-bold">{bot.pid || 4210}</span></span>
                <span>HEAP: <span className="text-[#00FF66] font-bold">{bot.memoryHeapMb || 95} MB</span></span>
                <span>AFFINITY: <span className="text-[#00FF66] font-bold">{bot.cpuAffinity || "Core 0"}</span></span>
                <span>VER: <span className="text-[#6FF] font-bold">v{bot.version || "1.0.0"}</span></span>
              </div>
              <div className="flex justify-between items-center text-[8px] text-zinc-600 pt-0.5">
                <span>TZ: <span className="text-zinc-300 font-bold">{bot.timezone || "UTC"}</span></span>
                <span>CG_CPU: <span className="text-[#00FF66] font-bold">{bot.cgroupsCpuLimit || "UNCAPPED"}</span></span>
                <span>CG_MEM: <span className="text-[#00FF66] font-bold">{bot.cgroupsMemoryLimit || "UNCAPPED"}</span></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
