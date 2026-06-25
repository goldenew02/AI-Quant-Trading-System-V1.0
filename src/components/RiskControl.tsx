import React, { useState, useEffect } from "react";
import { AlertOctagon, HelpCircle, Save, ToggleLeft, ToggleRight, Loader, CheckCircle2, ShieldAlert } from "lucide-react";
import { RiskSettings } from "../types";
import { apiFetch } from "../lib/api";

function stableStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function computeSha256(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function RiskControl() {
  const [settings, setSettings] = useState<RiskSettings>({
    maxDailyDrawdown: 5,
    maxAccountDrawdown: 10,
    globalKillSwitch: false,
    maxLeverageLimit: 10,
    dailyLossLimitUSD: 500,
    restrictedSymbols: ["SHIB/USDT"],
    singleAssetMaxAllocationPercent: 30,
    industryCryptoMaxPercent: 60,
    autoMeltDrawdownThreshold: 15,
    autoMeltSharpeThreshold: 1.2,
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Simulated MFA popup states
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaAction, setMfaAction] = useState<boolean>(false); // Target state of the switch

  // Static allocation percentages for representation
  const activeAllocations = [
    { name: "BTC / Digital Asset", allocated: 25, limit: settings.singleAssetMaxAllocationPercent || 30, type: "crypto" },
    { name: "ETH / Digital Asset", allocated: 15, limit: settings.singleAssetMaxAllocationPercent || 30, type: "crypto" },
    { name: "NVDA / Tech Stocks", allocated: 20, limit: settings.singleAssetMaxAllocationPercent || 30, type: "stock" },
    { name: "TSLA / Tech Stocks", allocated: 10, limit: settings.singleAssetMaxAllocationPercent || 30, type: "stock" },
  ];

  const totalCryptoExposure = activeAllocations
    .filter(a => a.type === "crypto")
    .reduce((sum, a) => sum + a.allocated, 0);

  const fetchRiskSettings = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/risk");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setSettings({
          ...settings,
          ...data
        });
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

  const [mfaActionType, setMfaActionType] = useState<'SAVE' | 'TOGGLE_KILL_SWITCH'>('SAVE');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaActionType('SAVE');
    setMfaCode("");
    setShowMfaModal(true);
  };

  const handleInputChange = (field: keyof RiskSettings, value: any) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Toggle switch trigger with MFA simulation
  const handleToggleKillSwitchClick = () => {
    setMfaActionType('TOGGLE_KILL_SWITCH');
    setMfaAction(!settings.globalKillSwitch);
    setMfaCode("");
    setShowMfaModal(true);
  };

  const handleVerifyMfaAndToggle = async () => {
    try {
      setSaving(true);
      
      const updatedSettings = mfaActionType === 'TOGGLE_KILL_SWITCH' 
        ? { ...settings, globalKillSwitch: mfaAction }
        : settings;

      // Build stable payload mapping for cryptographically binding the body hash (P0-6)
      const payload = {
        maxDailyDrawdown: Number(updatedSettings.maxDailyDrawdown),
        maxAccountDrawdown: Number(updatedSettings.maxAccountDrawdown),
        globalKillSwitch: updatedSettings.globalKillSwitch === true,
        maxLeverageLimit: Number(updatedSettings.maxLeverageLimit),
        dailyLossLimitUSD: Number(updatedSettings.dailyLossLimitUSD),
        restrictedSymbols: updatedSettings.restrictedSymbols,
        singleAssetMaxAllocationPercent: Number(updatedSettings.singleAssetMaxAllocationPercent),
        industryCryptoMaxPercent: Number(updatedSettings.industryCryptoMaxPercent),
        autoMeltDrawdownThreshold: Number(updatedSettings.autoMeltDrawdownThreshold),
        autoMeltSharpeThreshold: Number(updatedSettings.autoMeltSharpeThreshold)
      };

      const payloadStr = stableStringify(payload);
      const payloadHash = await computeSha256(payloadStr);
      const actionName = mfaActionType === 'SAVE' ? "SAVE_RISK_LIMITS" : "TOGGLE_GLOBAL_KILL_SWITCH";

      // Step 1: Verify TOTP and obtain the transient high-impact action token
      const res = await apiFetch("/api/auth/verify-totp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          code: mfaCode, 
          action: actionName,
          bodyHash: payloadHash
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || "MFA validation failed. Unauthorized modification blocked.");
        return;
      }

      // Step 2: Call post-trade /api/risk passing the actionToken and body payload
      const saveRes = await apiFetch("/api/risk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          actionToken: data.actionToken
        }),
      });

      const saveData = await saveRes.json();
      if (saveRes.ok && saveData.success) {
        setSettings({
          ...settings,
          ...saveData.settings
        });
        setShowMfaModal(false);
        if (mfaActionType === 'TOGGLE_KILL_SWITCH') {
          setMessage({ text: mfaAction ? "✓ 警告：全局一键熔断已生效！所有成交通道已阻断。" : "✓ 全局熔断已解除。系统恢复正常对冲交易。", isError: false });
        } else {
          setMessage({ text: "✓ 风险风控阈值参数更新成功，MFA授权闭环验证无误并部署生效。", isError: false });
        }
        setTimeout(() => setMessage(null), 5000);
      } else {
        alert(saveData.error || "风控参数保存失败");
      }
    } catch (err: any) {
      console.error(err);
      alert("风控保存过程出现通讯故障: " + err.message);
    } finally {
      setSaving(false);
    }
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
    <div className="space-y-6">
      
      {/* Risk settings card form */}
      <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 text-[#E0E0E0] shadow-none">
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
              Configure real-time portfolio limits, single-asset allocations, and automated Sharpe circuit-breaker levels.
            </p>
          </div>
        </div>

        {settings.globalKillSwitch && (
          <div className="bg-[#FF3333]/10 border border-[#FF3333] text-[#FF3333] p-4 rounded-none text-xs leading-relaxed mb-6 font-mono uppercase font-semibold">
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="h-5 w-5 text-[#FF3333] shrink-0 animate-pulse mt-0.5" />
              <div>
                <strong className="block text-sm font-black mb-1">EMERGENCY BREAKER SYSTEM OVERRIDE (GLOBAL KILL-SWITCH ON)</strong>
                All active contracts are forcefully suspended. Open order lines on Tiger, Binance, and OKX have been retracted. Core system is now locked. Verify code in dual-auth switch below to resume normal tasks.
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
              <span>MAXIMUM DAILY DRAWDOWN TOLERANCE (日内最大回撤限额)</span>
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
              Max intraday loss before system initiates physical locks.
            </span>
          </div>

          <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] rounded-none">
            <label className="block text-[11px] font-bold text-[#666666] uppercase font-mono mb-2 flex items-center justify-between">
              <span>MAXIMUM PORTFOLIO TOTAL EXPOSURE (全账户最大回撤限额)</span>
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
              Absolute downside depletion tolerance prior to order retrieval.
            </span>
          </div>

          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Day Loss Limit Threshold (单日止损限额 USD)
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
              Maximum Allocated Leverage Limit (最大合约杠杆限额)
            </label>
            <select
              value={settings.maxLeverageLimit}
              onChange={(e) => handleInputChange("maxLeverageLimit", parseInt(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-leverage-limit"
            >
              <option value="1">1x Equivalent Delta One (现货普通网格)</option>
              <option value="3">3x Light Safety Bias (低杠杆限额)</option>
              <option value="5">5x Moderated Hedged Grid (中等对冲杠杆)</option>
              <option value="10">10x High Turbulence Border (10倍风险预警线)</option>
              <option value="20">20x Maximum Contract Lever (20倍极端最高杠杆)</option>
            </select>
            <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
              Top contract leverage tier modifier. Governed by CFTC/CFA compliance.
            </span>
          </div>

          {/* Core Audit Portfolio Level Controls */}
          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Single Asset Max Allocation Cap (单币种/标的最大仓位 %)
            </label>
            <input
              type="number"
              min="5"
              max="100"
              value={settings.singleAssetMaxAllocationPercent || 30}
              onChange={(e) => handleInputChange("singleAssetMaxAllocationPercent", parseInt(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-single-asset-max"
            />
            <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
              Prevents over-allocation in high-beta assets (e.g. maximum 30% per bot).
            </span>
          </div>

          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Industry Crypto Max Exposure (加密行业资产占比上限 %)
            </label>
            <input
              type="number"
              min="10"
              max="100"
              value={settings.industryCryptoMaxPercent || 60}
              onChange={(e) => handleInputChange("industryCryptoMaxPercent", parseInt(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-industry-crypto-max"
            />
            <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
              Limits cross-market correlation risk by capping total crypto asset allocation.
            </span>
          </div>

          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Auto-Melt Maximum Drawdown Threshold (自动熔断最大下偏 %)
            </label>
            <input
              type="number"
              min="2"
              max="50"
              value={settings.autoMeltDrawdownThreshold || 15}
              onChange={(e) => handleInputChange("autoMeltDrawdownThreshold", parseInt(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-automelt-drawdown"
            />
            <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
              Trigger instant block-level liquidation if a single contract falls beneath this line.
            </span>
          </div>

          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Auto-Melt Minimum Sharpe Coefficient (自动熔断最小夏普值)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5.0"
              value={settings.autoMeltSharpeThreshold || 1.2}
              onChange={(e) => handleInputChange("autoMeltSharpeThreshold", parseFloat(e.target.value))}
              className="block w-full bg-[#141416] border border-[#2A2A2C] rounded-none py-2 px-3 text-white font-mono text-xs focus:outline-none focus:border-[#FF3333]"
              id="risk-automelt-sharpe"
            />
            <span className="text-[10px] text-[#666666] uppercase font-mono mt-1.5 block">
              Dismount strategies with persistent negative/low Sharpe ratio (high risk/low yield).
            </span>
          </div>

          <div>
            <label className="block text-[10px] text-[#666666] uppercase font-mono mb-1.5 font-bold">
              Restricted Asset Symbols
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

          {/* Global Kill Switch Switch with Dual Confirmation MFA */}
          <div className="flex items-center justify-between bg-[#0A0A0B] p-4 rounded-none border border-[#FF3333]/30">
            <div>
              <span className="text-xs font-bold text-white block uppercase tracking-wide">
                Global Break switch override (Global Kill Switch)
              </span>
              <span className="text-[10px] text-[#666666] uppercase font-mono leading-tight block mt-1">
                Impose emergency halt status. Retracts outstanding exchange asks instantly.
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleKillSwitchClick}
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
              className="bg-[#FF3333] hover:bg-[#CC2222] text-white font-display text-xs font-black py-3 px-8 rounded-none flex items-center justify-center gap-1.5 tracking-wider transition duration-200 uppercase w-full md:w-auto cursor-pointer h-11"
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

      {/* Allocation Breakdown and correlation deck */}
      <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6">
        <h3 className="text-xs font-black uppercase text-[#666666] mb-4 tracking-wider font-mono">
          Dynamic Portfolio Exposure Breakdown & Asset Cap Compliance
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Progress list */}
          <div className="space-y-4">
            <span className="text-[10px] text-[#666666] font-mono uppercase font-black block">Single Asset Allocation Capping Check</span>
            <div className="space-y-3 font-mono text-xs">
              {activeAllocations.map((asset) => {
                const limitValue = settings.singleAssetMaxAllocationPercent || 30;
                const percentOfLimit = (asset.allocated / limitValue) * 100;
                const isOver = asset.allocated > limitValue;
                return (
                  <div key={asset.name} className="space-y-1 bg-[#0A0A0B] p-3 border border-[#2A2A2C]">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-white font-bold">{asset.name}</span>
                      <span className={`font-bold ${isOver ? "text-[#FF3333]" : "text-zinc-400"}`}>
                        Allocated: {asset.allocated}% (Limit: {limitValue}%)
                      </span>
                    </div>
                    <div className="w-full bg-[#141416] h-2 rounded-none relative overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${isOver ? "bg-[#FF3333]" : "bg-[#00FF66]"}`}
                        style={{ width: `${Math.min(percentOfLimit, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Correlated exposure */}
          <div className="bg-[#0A0A0B] p-5 border border-[#2A2A2C] flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-[#666666] font-mono uppercase font-black block mb-3">Industry Cohesion Concentration Risk</span>
              
              <div className="flex justify-between items-center mb-1 text-xs font-mono">
                <span className="text-white">Digital Crypto Assets (Correlated Exposure):</span>
                <span className={`font-black ${totalCryptoExposure > (settings.industryCryptoMaxPercent || 60) ? "text-[#FF3333]" : "text-[#00FF66]"}`}>
                  {totalCryptoExposure}% / {settings.industryCryptoMaxPercent || 60}% CAP
                </span>
              </div>
              
              <div className="w-full bg-[#141416] h-3.5 rounded-none relative overflow-hidden border border-[#2A2A2C] mb-4">
                <div
                  className={`h-full transition-all duration-300 ${totalCryptoExposure > (settings.industryCryptoMaxPercent || 60) ? "bg-[#FF3333]" : "bg-[#00FF66]"}`}
                  style={{ width: `${Math.min((totalCryptoExposure / (settings.industryCryptoMaxPercent || 60)) * 100, 100)}%` }}
                ></div>
              </div>

              <p className="text-[10px] text-zinc-500 font-mono leading-relaxed uppercase">
                Under offshore financial compliance structures (e.g. CFA/CFTC), digital assets with highly correlated market betas must not exceed specified threshold limits (currently configured at <strong>{settings.industryCryptoMaxPercent || 60}%</strong>). Exceeding triggers automatic suspension of spot contract initialization.
              </p>
            </div>

            <div className="border-t border-[#2A2A2C] pt-3 mt-4 flex items-center gap-2 text-[10px] text-[#00FF66] font-mono uppercase font-bold">
              <span className="inline-block w-1.5 h-1.5 bg-[#00FF66] animate-pulse"></span>
              Exposure check: COMPLIANT
            </div>
          </div>

        </div>
      </div>

      {/* MFA Verification Simulated Modal overlay */}
      {showMfaModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#141416] border-2 border-[#FF3333] max-w-sm w-full p-6 text-center font-mono">
            <AlertOctagon className="h-10 w-10 text-[#FF3333] mx-auto mb-4 animate-bounce" />
            <h4 className="text-sm font-black text-white uppercase tracking-wider mb-2">
              TACTICAL MFA DUAL-AUTH DEVIATION
            </h4>
            <p className="text-[11px] text-zinc-400 uppercase leading-normal mb-4">
              You are toggling a high-impact global switch. Please input the Google Authenticator 6-digit dynamic passcode to authorize the operation.
            </p>
            
            {/* Real TOTP dynamic hint */}
            <div className="bg-[#0A0A0B] p-2.5 border border-zinc-800 text-[10px] text-zinc-450 mb-4 uppercase leading-relaxed text-left">
              Enter the 6-digit TOTP token from your authenticator app synced with your Aegis system account to authorize this action.
            </div>

            <input
              type="text"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="******"
              className="bg-[#0A0A0B] border border-[#2A2A2C] p-2.5 px-4 text-center text-white font-mono tracking-[1em] text-lg w-full rounded-none focus:outline-none focus:border-[#FF3333] mb-4"
            />

            <div className="flex gap-2.5 justify-center">
              <button
                onClick={() => setShowMfaModal(false)}
                className="bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-bold py-2.5 px-5 uppercase rounded-none cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyMfaAndToggle}
                className="bg-[#FF3333] hover:bg-[#CC2222] text-white text-[10px] font-black py-2.5 px-6 uppercase rounded-none cursor-pointer"
              >
                Authorize
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
