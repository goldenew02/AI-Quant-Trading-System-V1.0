import React, { useState } from "react";
import { Play, TrendingUp, Award, Activity, ShieldAlert, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface BacktestSuiteProps {
  onBacktestComplete: (result: any) => void;
}

export default function BacktestSuite({ onBacktestComplete }: BacktestSuiteProps) {
  const [config, setConfig] = useState({
    broker: "Binance",
    symbol: "BTC/USDT",
    type: "spot_grid",
    rangeMin: "60000",
    rangeMax: "70000",
    gridCount: "10",
    investment: "5000",
    days: "60",
    leverage: "5",
    stressTest: "none",
    seed: "42",
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [pastRuns, setPastRuns] = useState<any[]>([]);

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setResult(null);
      setAiReport(null);

      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          rangeMin: Number(config.rangeMin),
          rangeMax: Number(config.rangeMax),
          gridCount: Number(config.gridCount),
          investment: Number(config.investment),
          days: Number(config.days),
          leverage: Number(config.leverage),
          seed: Number(config.seed),
        }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setResult(data);
        onBacktestComplete(data);
        
        // Save to past runs history list
        const runRecord = {
          timestamp: new Date().toLocaleTimeString(),
          config: { ...config },
          result: data
        };
        setPastRuns(prev => [runRecord, ...prev]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAiAudit = async () => {
    if (!result) return;
    try {
      setAiLoading(true);
      setAiReport(null);

      const res = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `我运行了一份量化网格回测：
券商/交易所: ${config.broker}
交易标的: ${config.symbol}
网格区间: [${config.rangeMin} - ${config.rangeMax}], 格数: ${config.gridCount}
投入资金: $${config.investment}
回测周期: ${config.days} 天, 类型: ${config.type}, 杠杆: ${config.leverage}x
压力测试模式: ${config.stressTest}
随机种子: ${config.seed}
输出结果：
净收益: $${result.netProfit} (${(result.netProfit / Number(config.investment) * 100).toFixed(2)}%)
年化预期收益率: ${result.annualizedYield}%
夏普比率 (Sharpe Ratio): ${result.sharpeRatio}
最大区间偏离回撤 (Max Drawdown): ${result.maxDrawdown}%
对冲撮合次数: ${result.tradesFillCount} 次。
请帮我从定量与定性角度，给出一份专业的网格模型审计、压力场景波动与配置纠偏报告。`,
          backtestResult: result,
        }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setAiReport(data.analysis);
      }
    } catch (err) {
      console.error(err);
      setAiReport("未能生成智能回测审计报告，请检查 Secrets 配置。");
    } finally {
      setAiLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const applyPreset = (symbol: string) => {
    if (symbol === "BTC/USDT") {
      setConfig({
        broker: "Binance",
        symbol: "BTC/USDT",
        type: "spot_grid",
        rangeMin: "60000",
        rangeMax: "70050",
        gridCount: "12",
        investment: "3000",
        days: "60",
        leverage: "1",
        stressTest: "none",
        seed: "42",
      });
    } else if (symbol === "NVDA") {
      setConfig({
        broker: "Tiger",
        symbol: "NVDA",
        type: "spot_grid",
        rangeMin: "115",
        rangeMax: "138",
        gridCount: "8",
        investment: "5000",
        days: "90",
        leverage: "1",
        stressTest: "none",
        seed: "42",
      });
    } else if (symbol === "ETH/USDT") {
      setConfig({
        broker: "OKX",
        symbol: "ETH/USDT",
        type: "futures_grid",
        rangeMin: "3100",
        rangeMax: "3600",
        gridCount: "10",
        investment: "1500",
        days: "45",
        leverage: "5",
        stressTest: "2021_crypto",
        seed: "99",
      });
    }
  };

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Backtest Simulation Lab & Stress Tester
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
            Aegis Simulation Engine
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            Evaluate high-frequency portfolio models under historical stress scenarios with deterministic seeding.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => applyPreset("BTC/USDT")}
            className="text-[10px] bg-[#0A0A0B] hover:bg-neutral-800 text-[#E0E0E0] px-3 py-1.5 rounded-none border border-[#2A2A2C] transition-all font-mono uppercase font-bold cursor-pointer"
          >
            BTC STABLE PRESET
          </button>
          <button
            onClick={() => applyPreset("ETH/USDT")}
            className="text-[10px] bg-[#0A0A0B] hover:bg-neutral-800 text-[#E0E0E0] px-3 py-1.5 rounded-none border border-[#2A2A2C] transition-all font-mono uppercase font-bold cursor-pointer"
          >
            ETH LEVERAGED PRESET
          </button>
          <button
            onClick={() => applyPreset("NVDA")}
            className="text-[10px] bg-[#0A0A0B] hover:bg-neutral-800 text-[#E0E0E0] px-3 py-1.5 rounded-none border border-[#2A2A2C] transition-all font-mono uppercase font-bold cursor-pointer"
          >
            NVDA TECH STOCK PRESET
          </button>
        </div>
      </div>

      <form onSubmit={handleRunBacktest} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6" id="form-backtest">
        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Broker Engine</label>
          <select
            value={config.broker}
            onChange={(e) => handleInputChange("broker", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs select-none focus:outline-none focus:border-[#00FF66] font-sans"
            id="backtest-broker"
          >
            <option value="Binance">Binance Spot Access</option>
            <option value="OKX">OKX Derivative</option>
            <option value="Tiger">Tiger Securities (U.S.)</option>
            <option value="Longbridge">Longbridge Securities (H.K.)</option>
            <option value="IB">Interactive Brokers API</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Trading Symbol Pair</label>
          <input
            type="text"
            value={config.symbol}
            onChange={(e) => handleInputChange("symbol", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono font-bold"
            placeholder="e.g. BTC/USDT"
            id="backtest-symbol"
          />
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Grid Profile Type</label>
          <select
            value={config.type}
            onChange={(e) => handleInputChange("type", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs select-none focus:outline-none focus:border-[#00FF66] font-sans"
            id="backtest-type"
          >
            <option value="spot_grid">Spot Normal (现货普通网格)</option>
            <option value="futures_grid">Leveraged Contract (合约网格对冲)</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Injected Capital Size (USD)</label>
          <input
            type="number"
            value={config.investment}
            onChange={(e) => handleInputChange("investment", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono"
            id="backtest-investment"
          />
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Grid Bounds [Min - Max]</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={config.rangeMin}
              onChange={(e) => handleInputChange("rangeMin", e.target.value)}
              className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono text-center"
              placeholder="Bottom"
              id="backtest-rangemin"
            />
            <input
              type="number"
              value={config.rangeMax}
              onChange={(e) => handleInputChange("rangeMax", e.target.value)}
              className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono text-center"
              placeholder="Top"
              id="backtest-rangemax"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Layers Count & Days Cycle</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={config.gridCount}
              onChange={(e) => handleInputChange("gridCount", e.target.value)}
              placeholder="Grids"
              className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono text-center"
              id="backtest-gridcount"
            />
            <select
              value={config.days}
              onChange={(e) => handleInputChange("days", e.target.value)}
              className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs select-none focus:outline-none focus:border-[#00FF66] font-mono"
              id="backtest-days"
            >
              <option value="30">30 Days</option>
              <option value="60">60 Days</option>
              <option value="90">90 Days</option>
              <option value="180">180 Days</option>
              <option value="365">1 Year (365d)</option>
              <option value="730">2 Years (730d)</option>
              <option value="1095">3 Years (1095d)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Scenario Stress Test (压力测试场景)</label>
          <select
            value={config.stressTest}
            onChange={(e) => handleInputChange("stressTest", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs select-none focus:outline-none focus:border-[#00FF66] font-mono"
            id="backtest-stresstest"
          >
            <option value="none">None (Standard Market)</option>
            <option value="2015_ashare">2015 A-Share Meltdown (15年千股跌停)</option>
            <option value="2020_us">2020 US COVID Crash (20年多次熔断)</option>
            <option value="2021_crypto">2021 Crypto Liquidation Crash (519暴跌)</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1 font-bold">Deterministic Seed (随机数种子)</label>
          <input
            type="number"
            value={config.seed}
            onChange={(e) => handleInputChange("seed", e.target.value)}
            className="w-full bg-[#141416] border border-[#2A2A2C] rounded-none p-2 px-3 text-white text-xs focus:outline-none focus:border-[#00FF66] font-mono"
            id="backtest-seed"
          />
        </div>

        {config.type === "futures_grid" && (
          <div className="col-span-1 md:col-span-4 bg-[#0A0A0B] p-4 border border-[#2A2A2C] rounded-none">
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-2 font-bold">
              Contract Leverage Multiplier Ratio (1x - 20x)
            </label>
            <input
              type="range"
              min="1"
              max="20"
              value={config.leverage}
              onChange={(e) => handleInputChange("leverage", e.target.value)}
              className="w-full accent-[#00FF66] text-slate-700 bg-[#141416] h-1 rounded-none cursor-pointer"
              id="backtest-leverage"
            />
            <div className="flex justify-between text-[10px] text-[#666666] font-mono mt-2 uppercase font-bold">
              <span>1x (Delta neutral)</span>
              <span className="text-[#00FF66] font-black">SELECTED VALUE: {config.leverage}x</span>
              <span>20x (Extreme Risk Exposure)</span>
            </div>
          </div>
        )}

        <div className="col-span-1 md:col-span-4 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="bg-[#00FF66] hover:bg-[#00CC55] text-black text-xs font-black py-2.5 px-8 rounded-none flex items-center justify-center gap-1.5 tracking-wider transition duration-150 cursor-pointer uppercase w-full md:w-auto font-display"
            id="btn-run-backtest"
          >
            {loading ? (
              <RefreshCw className="animate-spin h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 fill-black" />
            )}
            {loading ? "ENGAGING HISTORIC SIMULATOR..." : "INITIATE SIMULATED BACKTEST RUN"}
          </button>
        </div>
      </form>

      {/* Result Metrics */}
      {result && (
        <div className="space-y-6 pt-4 border-t border-[#2A2A2C]" id="backtest-results-panel">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] text-center">
              <span className="text-[9px] text-[#666666] block uppercase font-mono mb-1">NET RETURN PNL</span>
              <div className="text-xl font-black font-display tracking-tight text-[#00FF66] italic">
                +${result.netProfit.toLocaleString()}
              </div>
              <span className="text-[10px] text-[#00FF66] font-mono font-black block mt-1">
                (+{(result.netProfit / Number(config.investment) * 100).toFixed(2)}%)
              </span>
            </div>

            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] text-center">
              <span className="text-[9px] text-[#666666] block uppercase font-mono mb-1">ANNUALIZED YIELD</span>
              <div className="text-xl font-black font-display tracking-tight text-[#00FF66] italic">
                {result.annualizedYield}%
              </div>
              <span className="text-[10px] text-[#666666] font-mono block mt-1 uppercase">GRID APR</span>
            </div>

            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] text-center">
              <span className="text-[9px] text-[#666666] block uppercase font-mono mb-1">SHARPE RATIO</span>
              <div className="text-xl font-black font-display tracking-tight text-white italic">
                {result.sharpeRatio}
              </div>
              <span className="text-[10px] text-[#666666] font-mono block mt-1 uppercase">VOL COEFFICIENT</span>
            </div>

            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C] text-center">
              <span className="text-[9px] text-[#666666] block uppercase font-mono mb-1">MAX DRAWDOWN</span>
              <div className="text-xl font-black font-display tracking-tight text-[#FF3333] italic">
                {result.maxDrawdown}%
              </div>
              <span className="text-[10px] text-[#666666] font-mono block mt-1 uppercase">MAX EXPOSURE</span>
            </div>

            <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#1d4ed8]/30 text-center col-span-2 md:col-span-1">
              <span className="text-[9px] text-[#666666] block uppercase font-mono mb-1">FILLED GRIDS TOLLS</span>
              <div className="text-xl font-black font-display tracking-tight text-[#0066FF] italic">
                {result.tradesFillCount} Tx
              </div>
              <span className="text-[10px] text-[#666666] font-mono block mt-1 uppercase">CROSS MATCHES</span>
            </div>
          </div>

          {/* Recharts chart representation */}
          <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C]">
            <h4 className="text-[10px] font-bold text-[#666666] mb-4 uppercase font-mono tracking-wider">
              PORTFOLIO EQUITY VALUE GROWTH CURVE
            </h4>
            <div className="h-64 sm:h-80 w-full text-[#E0E0E0]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2C" />
                  <XAxis dataKey="timestamp" stroke="#666666" fontSize={9} tickLine={false} />
                  <YAxis stroke="#666666" fontSize={9} width={45} domain={["auto", "auto"]} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0A0A0B", borderColor: "#2A2A2C", fontSize: "11px", borderRadius: "0px" }}
                    labelClassName="text-zinc-550 font-mono"
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "5px" }} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="System Net Capital Valuation (USD)"
                    stroke="#00FF66"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[9px] text-[#666666] font-mono text-center mt-3 uppercase tracking-tight">
              Notice: Reconstructed history charts model historical volatility with real drift.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* Quick trade lists */}
            <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C] flex-1 w-full">
              <h4 className="text-[10px] font-bold text-[#666666] mb-3 uppercase font-mono tracking-wider">
                Simulation Arbitrage Tx Ledger (Sample: Last 5 Match)
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-[#2A2A2C] text-[#666666] text-[9px] uppercase font-bold">
                      <th className="pb-3">Timestamp</th>
                      <th className="pb-3 text-center">Action</th>
                      <th className="pb-3 text-right">Match Price</th>
                      <th className="pb-3 text-right">Size Amount</th>
                      <th className="pb-3 text-right text-[#00FF66]">PnL Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.tradeRecords.slice(0, 5).map((rec: any, idx: number) => (
                      <tr key={idx} className="border-b border-[#141416] last:border-0 hover:bg-[#141416]/50">
                        <td className="py-2.5 text-[10px] text-zinc-400">
                          {new Date(rec.timestamp).toLocaleDateString()}{" "}
                          {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded-none text-[9px] font-black border uppercase ${
                              rec.type === "buy" ? "text-[#00FF66] border-[#00FF66] bg-emerald-950/20" : "text-[#FF3333] border-[#FF3333] bg-rose-955/20"
                            }`}
                          >
                            {rec.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-white">
                          ${rec.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 text-right text-zinc-400">{rec.amount}</td>
                        <td className="py-2.5 text-right text-[#00FF66] font-bold">
                          {rec.pnl ? `+$${rec.pnl.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI Advisor Panel inside diagnostics */}
            <div className="bg-[#141416] rounded-none border border-[#2A2A2C] p-5 w-full lg:w-96 text-xs flex flex-col justify-between self-stretch shrink-0">
              <div>
                <div className="flex items-center gap-1.5 text-[#00FF66] font-black mb-2 uppercase font-mono">
                  <Sparkles className="h-4 w-4 text-[#00FF66] animate-pulse" />
                  <span>Gemini Model Matrix Auditor</span>
                </div>
                <p className="text-zinc-400 leading-relaxed text-[11px] mb-4 font-mono uppercase">
                  Engage Google Gemini cognitive intelligence to audit simulated risk outcomes, evaluate slippage, and recalibrate grid layer parameters.
                </p>

                {aiLoading ? (
                  <div className="flex flex-col items-center justify-center py-7 gap-2.5 border border-dashed border-[#2A2A2C] rounded-none bg-[#0A0A0B]">
                    <RefreshCw className="animate-spin text-[#00FF66] h-5 w-5" />
                    <span className="text-[10px] text-[#666666] font-mono uppercase font-bold">REBUILDING EQUATIONS...</span>
                  </div>
                ) : aiReport ? (
                  <div className="bg-[#0A0A0B] p-3 rounded-none border border-[#2A2A2C] max-h-[160px] overflow-y-auto leading-normal text-slate-350 font-sans text-[11px] whitespace-pre-line scrollbar-thin">
                    {aiReport}
                  </div>
                ) : (
                  <div className="text-[10px] text-[#666666] border border-[#2A2A2C] p-4 rounded-none bg-[#0A0A0B] text-center flex items-center justify-center gap-1.5 font-mono uppercase font-bold">
                    <AlertCircle className="h-4 w-4" />
                    No previous diagnostics run log.
                  </div>
                )}
              </div>

              {!aiLoading && !aiReport && (
                <button
                  onClick={handleAiAudit}
                  className="mt-5 bg-[#00FF66] font-display hover:bg-[#00CC55] text-black font-black py-2.5 px-4 uppercase rounded-none transition duration-150 cursor-pointer text-center block w-full text-[11px] tracking-wider"
                  id="btn-trigger-backtest-ai-audit"
                >
                  AUDIT BOT SYSTEM WITH GEMINI
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Simulation execution history logs list */}
      {pastRuns.length > 0 && (
        <div className="mt-8 pt-6 border-t border-[#2A2A2C]" id="backtest-history-logs">
          <h4 className="text-[10px] font-bold text-[#666666] mb-4 uppercase font-mono tracking-wider">
            PREVIOUS RUNS HISTORY LOG (历史回测记录)
          </h4>
          <div className="space-y-3">
            {pastRuns.map((run, idx) => (
              <div key={idx} className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 font-mono text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#00FF66] font-black">{run.config.symbol}</span>
                    <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.2 rounded-none">{run.config.broker} ({run.config.days} Days)</span>
                    <span className="text-[9px] text-[#666666]">{run.timestamp}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 uppercase">
                    Grids: {run.config.gridCount} | Inv: ${run.config.investment} | Lev: {run.config.leverage}x | Stress: {run.config.stressTest} | Seed: {run.config.seed}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right col-span-1">
                    <span className="text-zinc-550 text-[9px] block">PNL RETURN</span>
                    <span className="text-[#00FF66] font-black italic">+${run.result.netProfit.toLocaleString()} (+{(run.result.netProfit / Number(run.config.investment) * 100).toFixed(2)}%)</span>
                  </div>
                  <div className="text-right col-span-1">
                    <span className="text-zinc-550 text-[9px] block">SHARPE RATIO</span>
                    <span className="text-white font-black">{run.result.sharpeRatio}</span>
                  </div>
                  <button
                    onClick={() => {
                      setResult(run.result);
                      setConfig(run.config);
                    }}
                    className="bg-[#2A2A2C] hover:bg-neutral-800 text-white text-[10px] font-bold py-1.5 px-3 rounded-none uppercase cursor-pointer"
                  >
                    View Result
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
