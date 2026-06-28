import React, { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Bot as BotIcon,
  Brain,
  Download,
  HelpCircle,
  ListCollapse,
  RefreshCw,
  Sliders,
  TrendingUp,
  LineChart,
  ShieldAlert,
  Moon,
  Laptop,
  Shield,
  LogOut,
  Fingerprint
} from "lucide-react";

import { BotConfig } from "./types";
import { apiFetch } from "./lib/api";
import SystemMetrics from "./components/SystemMetrics";
import RiskControl from "./components/RiskControl";
import LogAuditor from "./components/LogAuditor";
import AuditCopilot from "./components/AuditCopilot";
import BotCard from "./components/BotCard";
import LiveMonitor from "./components/LiveMonitor";
import BacktestSuite from "./components/BacktestSuite";
import AegisLogin from "./components/AegisLogin";
import SecurityLogs from "./components/SecurityLogs";
import UserAccountCenter from "./components/UserAccountCenter";
import BrokerAccountManager from "./components/BrokerAccountManager";

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "backtest" | "risk" | "ai" | "logs" | "security_logs" | "profile" | "brokers">("dashboard");
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastBacktestResult, setLastBacktestResult] = useState<any | null>(null);
  const [selectedBotForAi, setSelectedBotForAi] = useState<string>("bot_1");
  const [ibMode, setIbMode] = useState<"gateway" | "web_api_proxy">("web_api_proxy");
  const [ibStatus, setIbStatus] = useState<{ connected: boolean; username?: string; error?: string } | null>(null);

  // Live Bot Startup MFA prompt state variables
  const [showLiveBotMfaModal, setShowLiveBotMfaModal] = useState(false);
  const [mfaTargetBotId, setMfaTargetBotId] = useState<string | null>(null);
  const [liveBotMfaCode, setLiveBotMfaCode] = useState("");
  const [liveBotMfaError, setLiveBotMfaError] = useState("");

  // Secure HttpOnly session states
  const [username, setUsername] = useState<string | null>(localStorage.getItem("aegis_username"));
  const [role, setRole] = useState<'admin' | 'operator' | 'viewer' | null>(localStorage.getItem("aegis_role") as any);

  const handleLoginSuccess = (newRole: 'admin' | 'operator' | 'viewer', newUsername: string) => {
    setRole(newRole);
    setUsername(newUsername);
    localStorage.setItem("aegis_username", newUsername);
    localStorage.setItem("aegis_role", newRole);
  };

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST"
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
    setUsername(null);
    setRole(null);
    localStorage.removeItem("aegis_username");
    localStorage.removeItem("aegis_role");
  };

  const secureFetch = async (url: string, options: RequestInit = {}) => {
    return apiFetch(url, options);
  };

  // Fetch Bots state from Backend on boot & interval
  const fetchBots = async () => {
    try {
      const res = await secureFetch("/api/bots");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setBots(data);
      }
    } catch (err) {
      console.error("Error fetching bots:", err);
    }
  };

  // Fetch IB connection mode and connection status on mount
  const fetchIbMode = async () => {
    try {
      const res = await secureFetch("/api/ib-mode");
      if (res.ok) {
        const data = await res.json();
        setIbMode(data.mode);
      }
      
      const statusRes = await secureFetch("/api/ib/status");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setIbStatus(statusData.status);
      }
    } catch (err) {
      console.error("Error fetching IB mode & status:", err);
    }
  };

  const handleUpdateIbMode = async (mode: "gateway" | "web_api_proxy") => {
    try {
      const res = await secureFetch("/api/ib-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setIbMode(data.mode);
      }
      
      const statusRes = await secureFetch("/api/ib/status");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setIbStatus(statusData.status);
      }
    } catch (err) {
      console.error("Error updating IB mode & status:", err);
    }
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      setUsername(null);
      setRole(null);
    };
    window.addEventListener("aegis-unauthorized", handleUnauthorized);
    return () => window.removeEventListener("aegis-unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    // Validate session status on boot after fetching fresh anti-CSRF token
    const initSession = async () => {
      try {
        // Fetch initialization token to ensure CSRF cookie is populated on first load
        await fetch("/api/auth/csrf", { credentials: "include" });
        
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.mustEnrollTotp) {
            setUsername(null);
            setRole(null);
            localStorage.removeItem("aegis_username");
            localStorage.removeItem("aegis_role");
          } else {
            setUsername(data.username);
            setRole(data.role);
            localStorage.setItem("aegis_username", data.username);
            localStorage.setItem("aegis_role", data.role);
          }
        } else {
          setUsername(null);
          setRole(null);
          localStorage.removeItem("aegis_username");
          localStorage.removeItem("aegis_role");
        }
      } catch (err) {
        console.error("Session init failed on boot:", err);
      }
    };
    initSession();
  }, []);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    Promise.all([fetchBots(), fetchIbMode()]).then(() => setLoading(false));

    // Polling active bot prices & trade counters from simulated background environment every 4 seconds
    const interval = setInterval(fetchBots, 4000);
    return () => clearInterval(interval);
  }, [username]);

  const handleStartBot = async (id: string, actionToken?: string) => {
    // Find target bot to see if it's run in live execution mode
    const targetBot = bots.find(b => b.id === id);
    if (targetBot && targetBot.executionMode === "live" && !actionToken) {
      setMfaTargetBotId(id);
      setLiveBotMfaCode("");
      setLiveBotMfaError("");
      setShowLiveBotMfaModal(true);
      return;
    }

    try {
      const options: RequestInit = { method: "POST" };
      if (actionToken) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify({ actionToken });
      }
      const res = await secureFetch(`/api/bots/start/${id}`, options);
      if (res.ok) {
        fetchBots();
        setShowLiveBotMfaModal(false);
      } else {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          const errMsg = data.error || "无法启动网格机器人交易对。";
          if (actionToken) {
            setLiveBotMfaError(errMsg);
          } else {
            alert(errMsg);
          }
        } else {
          const fallbackMsg = "无法启动网格机器人交易对。";
          if (actionToken) {
            setLiveBotMfaError(fallbackMsg);
          } else {
            alert(fallbackMsg);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmLiveBotMfa = async () => {
    if (!mfaTargetBotId) return;
    setLiveBotMfaError("");
    try {
      // Cryptographically bind payload: { botId: id, executionMode: "live" }
      const payload = {
        botId: mfaTargetBotId,
        executionMode: "live"
      };
      
      const stableStringify = (obj: any) => JSON.stringify(obj, Object.keys(obj).sort());
      const payloadStr = stableStringify(payload);
      
      const encoder = new TextEncoder();
      const data = encoder.encode(payloadStr);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const payloadHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      // Step 1: Verify TOTP and obtain the transient action token
      const res = await secureFetch("/api/auth/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: liveBotMfaCode,
          action: "START_LIVE_BOT",
          bodyHash: payloadHash
        })
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        setLiveBotMfaError(resData.error || "MFA 动态验证码校验失败。");
        return;
      }

      // Step 2: Proceed with the startup
      await handleStartBot(mfaTargetBotId, resData.actionToken);
    } catch (err: any) {
      setLiveBotMfaError(err.message || "MFA 校验过程中发生未知异常。");
    }
  };

  const handleStopBot = async (id: string) => {
    try {
      const res = await secureFetch(`/api/bots/stop/${id}`, { method: "POST" });
      if (res.ok) {
        fetchBots();
      } else {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          alert(data.error || "无法停止网格机器人。");
        } else {
          alert("无法停止网格机器人。");
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfigureBot = async (id: string, config: any) => {
    try {
      const res = await secureFetch(`/api/bots/configure/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        fetchBots();
      } else {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          alert(data.error || "配置网格机器人失败。");
        } else {
          alert("配置网格机器人失败。");
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Portfolio aggregates
  const totalInvestment = bots.reduce((sum, b) => sum + b.investment, 0);
  const totalRealizedProfit = bots.reduce((sum, b) => sum + b.profitUsd, 0);
  const totalUnrealizedProfit = bots.reduce((sum, b) => sum + b.unrealizedProfitUsd, 0);
  const activeBotsCount = bots.filter((b) => b.status === "running").length;
  const portfolioReturnPercent = totalInvestment > 0 ? (totalRealizedProfit / totalInvestment) * 100 : 0;

  if (!username || !role) {
    return <AegisLogin onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E0E0E0] flex flex-col font-sans selection:bg-[#00FF66]/30 selection:text-[#00FF66]">
      
      {/* Absolute Head Section */}
      <header className="bg-[#141416]/95 backdrop-blur-md border-b border-[#2A2A2C] sticky top-0 z-30 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#00FF66] text-black rounded-none shadow-none">
              <TrendingUp className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic text-white font-display flex items-center gap-2">
                Aegis Ampere Quant
                <span className="text-[9px] bg-[#0A0A0B] text-[#00FF66] font-mono font-black px-2 py-0.5 rounded-none border border-[#2A2A2C] uppercase tracking-wider">
                  v2.4 LTS (7*24h)
                </span>
              </h1>
              <p className="text-[10px] text-[#666666] font-mono uppercase tracking-tight font-semibold mt-0.5">
                Oracle Cloud Tokyo Host (Ampere A1 ARM 2C/12G/100G) Automated Hedging Engine
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* User display */}
            <div className="bg-[#0A0A0B] border border-[#2A2A2C] p-2 px-3 rounded-none text-[10px] font-mono flex items-center gap-1.5 font-black uppercase text-zinc-300">
              <Fingerprint className="h-3.5 w-3.5 text-[#00FF66]" />
              <span>{username}</span>
              <span className={`text-[8px] px-1 py-0.2 rounded-none ${role === 'admin' ? 'bg-[#FF3333]/15 text-[#FF3333] border border-[#FF3333]/30' : role === 'operator' ? 'bg-[#3399FF]/15 text-[#3399FF] border border-[#3399FF]/30' : 'bg-zinc-800 text-zinc-400'}`}>
                {role}
              </span>
            </div>

            {/* Status light */}
            <div className="bg-[#0A0A0B] border border-[#2A2A2C] p-2 px-3 rounded-none text-[10px] font-mono flex items-center gap-2 font-black uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-[#00FF66] opacity-75"></span>
                <span className="relative inline-flex rounded-none h-2 w-2 bg-[#00FF66]"></span>
              </span>
              <span className="text-zinc-550">FEED RUN-TIME:</span>
              <span className="text-[#00FF66]">CONNECTED</span>
            </div>

            <div className="bg-[#0A0A0B] border border-[#2A2A2C] p-2 px-3 rounded-none text-[10px] font-mono flex items-center gap-1.5 font-black uppercase">
              <Laptop className="h-3.5 w-3.5 text-[#666666]" />
              <span className="text-zinc-500">HOST LOAD:</span>
              <span className="text-[#00FF66]">{activeBotsCount * 4 + 8}% CPU</span>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="bg-[#FF3333]/10 hover:bg-[#FF3333]/20 text-[#FF3333] border border-[#FF3333]/30 p-2 px-3 rounded-none text-[10px] font-mono flex items-center gap-1.5 font-black uppercase cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              LOGOUT
            </button>
          </div>
        </div>
      </header>

      {/* Main dashboard stats panel block */}
      <section className="bg-[#141416] border-b border-[#2A2A2C] px-4 sm:px-6 py-6">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4" id="portfolio-kpis">
          {/* Allocated Assets */}
          <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C]">
            <span className="text-[10px] text-[#666666] font-mono uppercase block mb-1.5 font-bold tracking-wider">
              Allocated Equity (出资额)
            </span>
            <div className="text-2xl font-black font-display tracking-tighter text-white italic mb-0.5">
              ${totalInvestment.toLocaleString()}
            </div>
            <p className="text-[10px] font-mono text-[#666666] uppercase font-bold">
              {bots.length} Active grid contracts
            </p>
          </div>

          {/* Realized profit */}
          <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C]">
            <span className="text-[10px] text-[#666666] font-mono uppercase block mb-1.5 font-bold tracking-wider">
              Realized Profit (实现套利)
            </span>
            <div className="text-2xl font-black font-display tracking-tighter text-[#00FF66] italic mb-0.5 flex items-baseline gap-1.5">
              +${totalRealizedProfit.toFixed(2)}
              <span className="text-xs text-[#00FF66] font-black">
                (+{portfolioReturnPercent.toFixed(2)}%)
              </span>
            </div>
            <p className="text-[10px] font-mono text-[#666666] uppercase font-bold">
              Automated offset capture
            </p>
          </div>

          {/* Floating PnL */}
          <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C]">
            <span className="text-[10px] text-[#666666] font-mono uppercase block mb-1.5 font-bold tracking-wider">
              Floating Exposure (未实现)
            </span>
            <div
              className={`text-2xl font-black font-display tracking-tighter italic mb-0.5 ${
                totalUnrealizedProfit >= 0 ? "text-[#00FF66]" : "text-[#FF3333]"
              }`}
            >
              {totalUnrealizedProfit >= 0 ? "+" : ""}
              ${totalUnrealizedProfit.toFixed(2)}
            </div>
            <p className="text-[10px] font-mono text-[#666666] uppercase font-bold">
              Real-time delta variation
            </p>
          </div>

          {/* Robot allocation */}
          <div className="bg-[#0A0A0B] p-5 rounded-none border border-[#2A2A2C] col-span-2 md:col-span-1">
            <span className="text-[10px] text-[#666666] font-mono uppercase block mb-1.5 font-bold tracking-wider">
              Hedged Engines (自主席位)
            </span>
            <div className="text-2xl font-black font-display tracking-tighter text-white italic mb-0.5 flex items-center justify-between">
              {activeBotsCount} / 4 RUNNING
              <span className="text-[9px] bg-emerald-950/20 text-[#00FF66] border border-[#00FF66] px-1.5 py-0.2 rounded-none font-mono uppercase font-black tracking-wider">
                ACTIVE
              </span>
            </div>
            <p className="text-[10px] font-mono text-[#666666] uppercase font-bold">
              Continuous 24h calibration
            </p>
          </div>
        </div>
      </section>

      {/* Main navigation layouts tabs */}
      <nav className="bg-[#141416] border-b border-[#2A2A2C] px-4 sm:px-6 sticky top-[72px] z-20">
        <div className="max-w-7xl mx-auto flex overflow-x-auto gap-1 py-0 text-xs scrollbar-none">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "dashboard"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-dashboard"
          >
            <BotIcon className="h-4 w-4 text-[#00FF66]" />
            GRID CORES (网格控制)
          </button>

          <button
            onClick={() => setActiveTab("backtest")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "backtest"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-backtest"
          >
            <Activity className="h-4 w-4 text-[#00FF66]" />
            STRATEGY MODELS (量化回测)
          </button>

          <button
            onClick={() => setActiveTab("risk")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "risk"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[2px] border-b-[#00FF66] border border-[#2A2A2C]"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-risk"
          >
            <ShieldAlert className="h-4 w-4 text-[#FF3333]" />
            SUPERVISION DECK (风控防线)
          </button>

          <button
            onClick={() => setActiveTab("ai")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "ai"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-ai-audit"
          >
            <Brain className="h-4 w-4 text-[#00FF66]" />
            GEMINI AUDITOR (AI 顾问)
          </button>

          <button
            onClick={() => setActiveTab("logs")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "logs"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-logs"
          >
            <ListCollapse className="h-4 w-4 text-[#00FF66]" />
            JOURNAL ENTRIES (成交流水)
          </button>

          <button
            onClick={() => setActiveTab("security_logs")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "security_logs"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-security-logs"
          >
            <Shield className="h-4 w-4 text-[#00FF66]" />
            SECURITY LEDGER (数字安全审计)
          </button>

          <button
            onClick={() => setActiveTab("brokers")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "brokers"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-brokers"
          >
            <Shield className="h-4 w-4 text-[#00FF66]" />
            BROKERS VAULT (券商直连)
          </button>

          <button
            onClick={() => setActiveTab("profile")}
            className={`py-3.5 px-5 rounded-none font-black shrink-0 transition flex items-center gap-2 cursor-pointer touch-manipulation min-h-[44px] uppercase font-display tracking-wider border-b-2 text-xs select-none ${
              activeTab === "profile"
                ? "bg-[#0A0A0B] text-[#00FF66] border-b-[#00FF66] border border-[#2A2A2C] border-b-2"
                : "text-[#666666] hover:text-white border border-transparent"
            }`}
            id="tab-profile"
          >
            <Fingerprint className="h-4 w-4 text-[#00FF66]" />
            ACCESS CONTROL (权限凭证)
          </button>
        </div>
      </nav>

      {/* Main content grids */}
      <main className="flex-1 max-w-7xl mx-auto p-4 sm:p-6 w-full relative z-10 transition-all duration-300">
        
        {/* Dynamic Warning Alert Banner if any block stops on risk parameters */}
        {bots.some((b) => b.status === "stopped_by_risk") && (
          <div className="bg-[#FF3333]/10 border border-[#FF3333] text-[#FF3333] p-4 rounded-none text-xs leading-relaxed mb-6 font-mono uppercase font-semibold">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-[#FF3333] shrink-0 animate-pulse mt-0.5" />
              <div>
                <strong className="block text-sm font-black mb-1">EMERGENCY SYSTEM SUSPENSION (DEVIATION BREACH TRIGGERED)</strong>
                A client position has exceeded dynamic drawback ratios or down-drift limits. Select contracts have been forcefully parked. Direct interfaces on exchanges are being monitored. Navigate to SUPERVISION to reset active thresholds.
              </div>
            </div>
          </div>
        )}

        {/* Content switch */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <RefreshCw className="animate-spin text-[#00FF66] h-6 w-6" />
            <p className="text-[10px] text-[#666666] font-mono tracking-wider uppercase font-black">Connecting dynamic system telemetries...</p>
          </div>
        ) : (
          <>
            {activeTab === "dashboard" && (
              <div className="space-y-6">
                
                {/* Performance Monitor Panel */}
                <SystemMetrics />

                {/* Left card grids, right interactive pricing ladder */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Bots cards */}
                  <div className="lg:col-span-2 space-y-5">
                    <div className="flex justify-between items-center border-b border-[#2A2A2C] pb-2">
                      <h2 className="text-[10px] tracking-[0.25em] font-black text-[#666666] font-mono uppercase">
                        ACTIVE QUANT STRATEGIES / 4 POSITIONS
                      </h2>
                      <span className="text-[9px] text-[#00FF66] uppercase font-mono font-black bg-[#0A0A0B] px-1.5 py-0.5 border border-[#2A2A2C]">
                        Independent Matrix Routing
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {bots.map((bot) => (
                        <BotCard
                          key={bot.id}
                          bot={bot}
                          onStart={handleStartBot}
                          onStop={handleStopBot}
                          onConfigure={handleConfigureBot}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Pricing ladder */}
                  <div className="lg:col-span-1">
                    <LiveMonitor bots={bots} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "backtest" && (
              <div className="space-y-6">
                <BacktestSuite onBacktestComplete={(res) => setLastBacktestResult(res)} />
              </div>
            )}

            {activeTab === "risk" && (
              <div className="space-y-6">
                <RiskControl />
                <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-5 text-[#E0E0E0]">
                  <h3 className="text-xs font-black uppercase text-[#666666] mb-3.5 tracking-wider font-mono">
                    EXTERNAL ENDPOINTS & PRIVATE EXCHANGE CLEARANCE TELEMETRY
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-mono">
                    <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-white uppercase text-[11px]">Binance & OKX Contracts</span>
                        <span className="text-[9px] bg-emerald-950/20 text-[#00FF66] border border-[#00FF66] px-1.5 py-0.2 rounded-none font-bold uppercase">
                          CONNECTED
                        </span>
                      </div>
                      <p className="text-[10px] text-[#666666] uppercase mt-1">24H High-frequency pipeline enabled. Support dual-hedged spot/futures offset grids.</p>
                    </div>

                    <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-white uppercase text-[11px]">Tiger & Longbridge API</span>
                        <span className="text-[9px] bg-emerald-950/20 text-[#00FF66] border border-[#00FF66] px-1.5 py-0.2 rounded-none font-bold uppercase">
                          CONNECTED
                        </span>
                      </div>
                      <p className="text-[10px] text-[#666666] uppercase mt-1">Direct brokerage execution enabled. Safe gapped layout configuration prevents slip.</p>
                    </div>

                    <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]">
                      <div className="flex justify-between items-center mb-1 pb-1 border-b border-[#2A2A2C]/50">
                        <span className="font-bold text-white uppercase text-[11px]">Interactive Brokers Node</span>
                        <select
                          value={ibMode}
                          onChange={(e) => handleUpdateIbMode(e.target.value as "gateway" | "web_api_proxy")}
                          className="text-[9px] bg-[#141416] text-[#00FF66] border border-[#2A2A2C] px-1.5 py-0.5 rounded-none font-mono uppercase font-black focus:outline-none focus:border-[#00FF66]"
                        >
                          <option value="web_api_proxy">Proxy (ARM)</option>
                          <option value="gateway">Gateway (x86)</option>
                        </select>
                      </div>
                      <div className="mt-2 text-[10px]">
                        {ibMode === "web_api_proxy" ? (
                          <>
                            <div className="flex items-center gap-1 text-[#00FF66] font-bold mb-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF66] animate-pulse"></span>
                              <span>ARM64 WEB PROXY (ACTIVE)</span>
                            </div>
                            <p className="text-[#666666] uppercase leading-tight mb-2">
                              Bypasses local x86 TWS Gateway limitations using ARM64-native REST proxy. Highly recommended for virtualization.
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1 text-amber-500 font-bold mb-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              <span>LOCAL TWS GATEWAY (EMULATED)</span>
                            </div>
                            <p className="text-[#666666] uppercase leading-tight mb-2">
                              Runs standard x86 gateway. Under ARM64, this forces slow binary translation layer emulation. Potential latency drift.
                            </p>
                          </>
                        )}

                        {/* Live Broker Connection Status Panel (P0-4 Compliance) */}
                        <div className="border-t border-[#2A2A2C]/40 pt-2 mt-2">
                          <div className="flex justify-between text-[9px] font-mono uppercase">
                            <span className="text-[#666666]">Broker API Status:</span>
                            {ibStatus?.connected ? (
                              <span className="text-[#00FF66] font-bold">● CONNECTED ({ibStatus.username})</span>
                            ) : (
                              <span className="text-[#FF3333] font-bold">● SIMULATION FALLBACK (OFFLINE)</span>
                            )}
                          </div>
                          {ibStatus && !ibStatus.connected && (
                            <p className="text-[8px] text-[#555557] font-mono uppercase leading-tight mt-1">
                              {ibStatus.error || "No session detected on local Gateway port 5000."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <div className="space-y-6">
                {/* Dropdown to select customized bot context */}
                <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className="text-xs font-black uppercase text-[#666666] font-mono tracking-wider">
                      SELECT ACTIVE ENGINE STATE TO INJECT (AI Context)
                    </h3>
                    <p className="text-[10px] text-[#666666] font-mono uppercase mt-0.5">
                      Targeted engine stats and dynamic thresholds are parsed into the Gemini context.
                    </p>
                  </div>
                  <select
                    value={selectedBotForAi}
                    onChange={(e) => setSelectedBotForAi(e.target.value)}
                    className="bg-[#0A0A0B] text-white text-xs rounded-none border border-[#2A2A2C] py-2 px-4 focus:outline-none focus:border-[#00FF66] font-mono uppercase"
                    id="ai-bot-context-selector"
                  >
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        ENG-{b.id.toUpperCase()}: {b.name.toUpperCase()} (${b.currentPrice})
                      </option>
                    ))}
                  </select>
                </div>

                <AuditCopilot activeBotId={selectedBotForAi} backtestData={lastBacktestResult} />
              </div>
            )}

            {activeTab === "logs" && (
              <div className="space-y-6">
                <LogAuditor />
              </div>
            )}

            {activeTab === "security_logs" && (
              <div className="space-y-6">
                <SecurityLogs secureFetch={secureFetch} />
              </div>
            )}

            {activeTab === "profile" && (
              <div className="space-y-6">
                <UserAccountCenter secureFetch={secureFetch} currentRole={role!} currentUsername={username!} />
              </div>
            )}

            {activeTab === "brokers" && (
              <div className="space-y-6">
                <BrokerAccountManager role={role} username={username} />
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer system status bar */}
      <footer className="bg-[#141416] border-t border-[#2A2A2C] mt-auto py-5 px-4 text-center text-[10px] text-[#666666] uppercase font-mono tracking-tight font-bold">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <span>
            © 2026 Aegis Ampere Quant. High-performance engine for Oracle A1 Bare-Metal running on Ubuntu 24.04 LTS (ARM-aarch64).
          </span>
          <span>
            Telemetry status SLA: 100% | Sandbox tick rate: 4.00 SECONDS
          </span>
        </div>
      </footer>

      {/* Live Trading Bot Startup MFA Dialog (P1-3 / P1-5) */}
      {showLiveBotMfaModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#0D0D0E] border-2 border-amber-500/80 max-w-md w-full p-6 font-mono text-xs shadow-2xl relative">
            <h3 className="text-amber-500 font-black text-[11px] uppercase tracking-wider border-b border-[#2A2A2C] pb-3 mb-4 flex items-center gap-2">
              <span className="animate-ping inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
              TACTICAL REAL-TIME LIVE ACTIVATION DEVIATION (实盘安全审计)
            </h3>
            
            <p className="text-[#AAAAAA] uppercase leading-relaxed mb-4">
              WARNING: You are about to authorize and activate a real money Live-Trading Bot on active exchanges. This action triggers direct financial exposure.
            </p>

            <div className="bg-[#141416] border border-[#2A2A2C] p-3 mb-4 rounded-none">
              <p className="text-[#666666] font-bold text-[9px] uppercase tracking-wider mb-1">BOUND PAYLOAD DETAILS</p>
              <div className="grid grid-cols-2 gap-y-1 text-[#CCCCCC] text-[10px]">
                <span>BOT IDENTIFIER:</span>
                <span className="text-amber-400 font-bold">ENG-{mfaTargetBotId?.toUpperCase()}</span>
                <span>EXECUTION MODE:</span>
                <span className="text-amber-400 font-bold">LIVE (实盘交易)</span>
                <span>SECURITY PROTOCOL:</span>
                <span className="text-zinc-500 font-bold">START_LIVE_BOT</span>
              </div>
            </div>

            {liveBotMfaError && (
              <div className="bg-[#2D1414] border border-[#CC3333] text-[#FF5555] p-3 mb-4 rounded-none text-[10px] uppercase font-bold tracking-tight">
                CRITICAL WARNING: {liveBotMfaError}
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                ENTER 6-DIGIT GOOGLE AUTHENTICATOR CODE:
              </label>
              <input
                type="text"
                maxLength={6}
                value={liveBotMfaCode}
                onChange={(e) => setLiveBotMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full bg-[#141416] border border-[#2A2A2C] text-white py-2.5 px-3 text-center text-lg tracking-widest focus:outline-none focus:border-amber-500 rounded-none placeholder-zinc-700"
                id="live-bot-mfa-input"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowLiveBotMfaModal(false);
                  setMfaTargetBotId(null);
                }}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-2 px-3 uppercase tracking-wider text-[10px] rounded-none transition cursor-pointer"
              >
                ABORT DEVIATION
              </button>
              <button
                onClick={handleConfirmLiveBotMfa}
                disabled={liveBotMfaCode.length !== 6}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-800/20 disabled:text-zinc-600 text-black font-black py-2 px-3 uppercase tracking-wider text-[10px] rounded-none transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                AUTHORIZE SIGNATURE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
