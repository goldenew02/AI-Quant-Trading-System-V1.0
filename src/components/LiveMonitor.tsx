import React, { useState } from "react";
import { Layers, Activity, TrendingUp, RefreshCw, Star } from "lucide-react";
import { BotConfig } from "../types";

interface LiveMonitorProps {
  bots: BotConfig[];
}

export default function LiveMonitor({ bots }: LiveMonitorProps) {
  const [selectedBotId, setSelectedBotId] = useState<string>("");

  const selectedBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  if (!selectedBot) {
    return (
      <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
        <div className="flex flex-col items-center justify-center py-20 text-[#666666]">
          <Activity className="h-8 w-8 mb-2 animate-pulse" />
          <p className="text-[10px] uppercase font-mono font-bold tracking-wider">LADDER WATCH SYSTEM INITIALIZING...</p>
        </div>
      </div>
    );
  }

  // Grid line visual status sorter (Sort grids from highest price to lowest price)
  const sortedGrids = [...(selectedBot.grids || [])].sort((a, b) => b.price - a.price);

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Realtime Execution Matrix
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display flex items-center gap-2">
            <Activity className="h-5 w-5 text-[#00FF66] animate-pulse" />
            Live Ladder Watch
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            Visualization of pending grid orders. BUY offers are color coded green, SELL ask walls are red.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-[#666666] font-mono uppercase font-bold">Monitor target:</label>
          <select
            value={selectedBot.id}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="bg-[#0A0A0B] border border-[#2A2A2C] text-white text-xs rounded-none py-1.5 px-3 focus:outline-none focus:border-[#00FF66] font-mono uppercase"
            id="monitor-bot-selector"
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} [{b.symbol}]
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left price stats */}
        <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-[#666666]">
              <span className="text-[10px] uppercase font-mono">TICKER CODE</span>
              <span className="text-xs text-white font-black font-mono">{selectedBot.symbol}</span>
              <span className="text-[10px] border border-[#2A2A2C] bg-[#141416] text-[#00FF66] font-mono px-1.5 py-0.2 rounded-none font-bold uppercase">
                {selectedBot.broker}
              </span>
            </div>

            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-3xl font-black font-mono tracking-tighter text-[#00FF66]">
                ${selectedBot.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-[#666666] font-mono uppercase">Spot Price</span>
            </div>

            <div className="space-y-2 text-xs border-t border-[#2A2A2C] pt-4 font-mono">
              <div className="flex justify-between">
                <span className="text-[#666666] uppercase text-[10px]">GRID SPAN LIMITS</span>
                <span className="text-[#E0E0E0]">
                  ${selectedBot.rangeMin} - ${selectedBot.rangeMax}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666] uppercase text-[10px]">INITIAL ACQUISITION</span>
                <span className="text-[#E0E0E0]">
                  ${selectedBot.entryPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666] uppercase text-[10px]">GRID TOTAL LAYERS</span>
                <span className="text-[#E0E0E0] font-bold">{selectedBot.gridCount} Levels</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666666] uppercase text-[10px]">TICKET UNIT PER LAYER</span>
                <span className="text-[#00FF66] font-bold">
                  {selectedBot.grids[0]?.amount?.toFixed(4) || "0.01"} / 格
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#2A2A2C]">
            <h4 className="text-[10px] uppercase font-mono text-[#666666] mb-2 flex items-center justify-between font-bold">
              <span>Arbitrage Performance</span>
              <span className="text-[#00FF66]">
                {selectedBot.profitPercent.toFixed(2)}%
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-[#141416] p-3 rounded-none border border-[#2A2A2C]">
                <span className="text-[9px] text-[#666666] uppercase block mb-1">Realized Net</span>
                <div className="text-[#00FF66] font-black">+${selectedBot.profitUsd}</div>
              </div>
              <div className="bg-[#141416] p-3 rounded-none border border-[#2A2A2C]">
                <span className="text-[9px] text-[#666666] uppercase block mb-1">Unrealized Delta</span>
                <div
                  className={`font-black ${
                    selectedBot.unrealizedProfitUsd >= 0 ? "text-[#00FF66]" : "text-[#FF3333]"
                  }`}
                >
                  {selectedBot.unrealizedProfitUsd >= 0 ? "+" : ""}
                  ${selectedBot.unrealizedProfitUsd}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right order ladder */}
        <div className="md:col-span-2 flex flex-col">
          <div className="text-xs font-bold text-[#666666] mb-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 px-1 uppercase font-mono">
            <span>Price Grid Order Book / 挂单梯队</span>
            <span className="text-[10px] text-[#E0E0E0] flex items-center gap-1">
              <TrendingUp className="h-3 w-4 text-[#00FF66]" />
              Spot current: ${selectedBot.currentPrice.toLocaleString()}
            </span>
          </div>

          {/* Grids list ladder */}
          <div className="bg-[#0A0A0B] p-3 border border-[#2A2A2C] rounded-none flex-1 max-h-[300px] overflow-y-auto space-y-1.5 scrollbar-thin">
            {sortedGrids.map((grid, index) => {
              const isCurrentBucketRange =
                selectedBot.currentPrice >= grid.price &&
                (index === 0 || selectedBot.currentPrice < sortedGrids[index - 1].price);

              const isBuyLine = grid.type === "buy";

              return (
                <div
                  key={index}
                  className={`flex justify-between items-center text-xs p-2 rounded-none font-mono ${
                    isCurrentBucketRange
                      ? "bg-[#141416] border border-[#00FF66]"
                      : "bg-[#141416]/50 border border-transparent"
                  }`}
                >
                  {/* Left Label */}
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-[9px] font-black px-1.5 py-0.5 rounded-none border ${
                        isBuyLine
                          ? "bg-emerald-950/45 text-[#00FF66] border-[#00FF66]"
                          : "bg-rose-950/45 text-[#FF3333] border-[#FF3333]"
                      }`}
                    >
                      {isBuyLine ? "BUY" : "SELL"}
                    </span>
                    <span
                      className={`text-xs ${
                        isCurrentBucketRange
                          ? "text-[#00FF66] font-black"
                          : isBuyLine
                          ? "text-[#E0E0E0]"
                          : "text-zinc-400"
                      }`}
                    >
                      ${grid.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Mid status */}
                  <div className="text-[10px] uppercase">
                    {grid.filled ? (
                      <span className="text-[#00FF66] bg-emerald-950/30 px-1.5 py-0.5 border border-[#00FF66]/20">
                        FILLED
                      </span>
                    ) : (
                      <span className="text-zinc-500 font-mono">PENDING price trigger</span>
                    )}
                  </div>

                  {/* Right order value */}
                  <div className="text-zinc-500 text-right text-[11px]">
                    {grid.amount} units (${(grid.amount * grid.price).toLocaleString(undefined, { maximumFractionDigits: 2 })})
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
