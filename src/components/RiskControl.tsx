import React, { useState, useEffect } from "react";
import { AlertOctagon, HelpCircle, Save, ToggleLeft, ToggleRight, Loader } from "lucide-react";
import { RiskSettings } from "../types";

export default function RiskControl() {
  const [settings, setSettings] = useState<RiskSettings>({
    maxDailyDrawdown: 5,
    maxAccountDrawdown: 10,
    globalKillSwitch: false,
    maxLeverageLimit: 10,
    dailyLossLimitUSD: 500,
    restrictedSymbols: ["SHIB/USDT"],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const fetchRiskSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/risk");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiskSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch("/api/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setMessage({ text: "✓ 量化风控参数已更新，系统已即时应用。", isError: false });
        setTimeout(() => setMessage(null), 4000);
      } else {
        setMessage({ text: "错误: 无法保存风控配置。", isError: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "错误: 无法连接至风控后端服务。", isError: true });
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field: keyof RiskSettings, value: any) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2 justify-center items-center h-48 bg-[#141416] border border-[#2A2A2C] rounded-none">
        <Loader className="animate-spin text-[#FF3333] h-6 w-6" />
        <span className="text-xs text-[#666666] font-mono uppercase tracking-wider font-bold">DOWNLOADING DEVIATION LIMITS...</span>
      </div>
    );
  }

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      <div className="flex gap-3 items-center mb-6 border-b border-[#2A2A2C] pb-4">
        <AlertOctagon className="h-6 w-6 text-[#FF3333]" />
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Tactical Risk Supervision Unit
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
            Aegis Guard Mitigation Controls
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            Active telemetry threshold managers. Liquidate and freeze active nodes on real-time slip limits.
          </p>
        </div>
      </div>

      {settings.globalKillSwitch && (
        <div className="bg-[#FF3333]/10 border border-[#FF3333] text-[#FF3333] p-4 rounded-none text-xs leading-relaxed mb-6 font-mono uppercase font-semibold">
          <div className="flex items-start gap-2.5">
            <AlertOctagon className="h-5 w-5 text-[#FF3333] shrink-0 animate-pulse" />
            <div>
              <strong className="block text-sm font-black mb-1">EMERGENCY BREAKER SYSTEM OVERRIDE (GLOBAL KILL-SWITCH ON)</strong>
              All four active grid contracts are forcefully suspended. Open order lines on Tiger, Binance, and OKX have been retracted. Core system is now locked. Override switch below to resume normal tasks.
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`p-4 rounded-none text-xs mb-6 font-mono uppercase font-bold border ${
            message.isError
              ? "bg-[#FF3333]/10 border-[#FF3333] text-[#FF3333]"
              : "bg-emerald-950/20 border-[#00FF66] text-[#00FF66]"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6" id="form-risk-control">
        <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] rounded-none">
          <label className="block text-[11px] font-bold text-[#666666] uppercase font-mono mb-2 flex items-center justify-between">
            <span>MAXIMUM DAILY DRAWDOWN TOLERANCE (%)</span>
            <span className="font-mono text-[#00FF66] font-black text-xs italic">{settings.maxDailyDrawdown}%</span>
          </label>
          <input
            type="range"
            min="1"
            max="30"
            step="0.5"
            value={settings.maxDailyDrawdown}
            onChange={(e) => handleInputChange("maxDailyDrawdown", parseFloat(e.target.value))}
            className="w-full accent-[#FF3333] cursor-pointer text-slate-700 bg-[#141416] h-1"
            id="risk-daily-drawdown"
          />
          <span className="text-[10px] text-[#666666] uppercase font-mono mt-2 block">
            Max intraday exposure coefficient before system initiates safety locks.
          </span>
        </div>

        <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] rounded-none">
          <label className="block text-[11px] font-bold text-[#666666] uppercase font-mono mb-2 flex items-center justify-between">
            <span>MAXIMUM PORTFOLIO TOTAL EXPOSURE (%)</span>
            <span className="font-mono text-[#00FF66] font-black text-xs italic">{settings.maxAccountDrawdown}%</span>
          </label>
          <input
            type="range"
            min="5"
            max="50"
            step="1"
            value={settings.maxAccountDrawdown}
            onChange={(e) => handleInputChange("maxAccountDrawdown", parseInt(e.target.value))}
            className="w-full accent-[#FF3333] cursor-pointer text-slate-700 bg-[#141416] h-1"
            id="risk-account-drawdown"
          />
          <span className="text-[10px] text-[#666666] uppercase font-mono mt-2 block">
            Absolute downside depletion tolerance prior to physical order retrieval.
          </span>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
            Day Loss Limit Threshold (USD)
          </label>
          <div className="relative rounded-none">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-[#666666] text-xs font-mono">$</span>
            </div>
            <input
              type="number"
              value={settings.dailyLossLimitUSD}
              onChange={(e) => handleInputChange("dailyLossLimitUSD", parseInt(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 pl-7 pr-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-loss-limit"
            />
          </div>
          <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
            Dual spot asset loss breaker. Resets precisely on UTC midnight.
          </span>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
            Maximum Allocated Leverage Limit (x)
          </label>
          <select
            value={settings.maxLeverageLimit}
            onChange={(e) => handleInputChange("maxLeverageLimit", parseInt(e.target.value))}
            className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
            id="risk-leverage-limit"
          >
            <option value="1">1x Equivalent Delta One (现货对齐)</option>
            <option value="3">3x Light Safety Bias (低风险杠杆)</option>
            <option value="5">5x Moderated Hedged Grid (平衡型网格)</option>
            <option value="10">10x High Turbulence Border (警戒拉制)</option>
            <option value="20">20x Maximum Contract Lever (极端高危线)</option>
          </select>
          <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
            Top contract tier modifier. Exceeding is governed by safety policy layers.
          </span>
        </div>

        <div>
          <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
            Restricted Asset Symbols (Restricted Symbols)
          </label>
          <input
            type="text"
            value={settings.restrictedSymbols.join(", ")}
            onChange={(e) =>
              handleInputChange(
                "restrictedSymbols",
                 e.target.value.split(",").map((s) => s.trim())
              )
            }
            placeholder="e.g. DOGE/USDT, SHIB/USDT"
            className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
            id="risk-restricted-symbols"
          />
          <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
            Exclude rapid fluctuations, memecoins, or illiquid products using comma splitting.
          </span>
        </div>

        {/* Global Kill Switch */}
        <div className="flex items-center justify-between bg-[#0A0A0B] p-4 rounded-none border border-[#FF3333]/30">
          <div>
            <span className="text-xs font-bold text-white block uppercase tracking-wide">
              Global Break switch override (Global Kill Switch)
            </span>
            <span className="text-[10px] text-[#666666] uppercase font-mono leading-tight block mt-1">
              Impose emergency halt status. Revokes outstanding system asks instantly.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleInputChange("globalKillSwitch", !settings.globalKillSwitch)}
            className="p-1 cursor-pointer transition-all"
            id="btn-global-kill-switch"
          >
            {settings.globalKillSwitch ? (
              <ToggleRight className="h-8 w-14 text-[#FF3333]" />
            ) : (
              <ToggleLeft className="h-8 w-14 text-zinc-650 hover:text-zinc-500" />
            )}
          </button>
        </div>

        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-[#FF3333] hover:bg-[#CC2222] text-white font-display text-xs font-black py-3 px-8 rounded-none flex items-center justify-center gap-1.5 tracking-wider transition duration-200 uppercase w-full md:w-auto cursor-pointer"
            id="btn-save-risk"
          >
            {saving ? (
              <Loader className="animate-spin h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Force Update Supervision Limits
          </button>
        </div>
      </form>
    </div>
  );
}
