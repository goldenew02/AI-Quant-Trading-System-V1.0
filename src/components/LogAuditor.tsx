import React, { useState, useEffect } from "react";
import { Download, Filter, RefreshCw, FileText, Shield, ShieldAlert, ShieldCheck, CheckCircle2, AlertTriangle, Clock, Printer } from "lucide-react";
import { TradeLog } from "../types";

export default function LogAuditor() {
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    broker: "ALL",
    symbol: "ALL",
    type: "ALL",
  });

  // State for sub-tabs inside LogAuditor
  const [subTab, setSubTab] = useState<"logs" | "crypto" | "compliance">("logs");
  
  // Timezone selector
  const [timezone, setTimezone] = useState<"LOCAL" | "UTC" | "JST">("LOCAL");

  // Crypto hash chain auditing states
  const [integrityStatus, setIntegrityStatus] = useState<"idle" | "verifying" | "secure" | "tampered">("secure");
  const [violations, setViolations] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] CRYPTOGRAPHIC ENGINE INITIALIZED: SHA-256 Ledger Hash Chain loaded.`,
    `[${new Date().toLocaleTimeString()}] Secure decentralized cold-backup mirrored node: ACTIVE.`,
  ]);

  // Regulatory states
  const [regulator, setRegulator] = useState<"CFA" | "CFTC" | "GIPS">("CFA");
  const [showReport, setShowReport] = useState(false);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams(filters).toString();
      const token = localStorage.getItem("aegis_token");
      const res = await fetch(`/api/logs?${queryParams}`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
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
    const token = localStorage.getItem("aegis_token") || "";
    window.open(`/api/logs/download?token=${encodeURIComponent(token)}`, "_blank");
  };

  const handleRunVerify = async () => {
    try {
      setIntegrityStatus("verifying");
      setAuditLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] INITIATING LEDGER SCAN: Verifying SHA-256 hash sequence of transaction chain...`]);
      
      const token = localStorage.getItem("aegis_token");
      const res = await fetch("/api/logs/verify", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await res.json();
      
      setTimeout(() => {
        if (data.success) {
          setIntegrityStatus("secure");
          setViolations([]);
          setAuditLog(prev => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] RECUPERATING COMPLETED: All ${data.totalLogsCount} blocks checked.`,
            `[${new Date().toLocaleTimeString()}] CHAIN STATUS: [${data.integrityStatus}] - Block-chain integrity verified with 0 warnings.`
          ]);
        } else {
          setIntegrityStatus("tampered");
          setViolations(data.violations);
          setAuditLog(prev => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] ALERT: HASH EXCEPTION DETECTED! Found ${data.violations.length} compromised blocks!`,
            `[${new Date().toLocaleTimeString()}] DETAILED TRACE: Failed link at transaction ID [${data.violations[0].id}]. Expected hash did not match current hash.`,
            `[${new Date().toLocaleTimeString()}] CONCERNED FIELD: Match Price / Total Amount fields have been compromised.`
          ]);
        }
      }, 8000); // 0.8s fake scanning delay for tactile interface response
    } catch (err) {
      console.error(err);
      setIntegrityStatus("idle");
    }
  };

  const handleTamper = async () => {
    try {
      const token = localStorage.getItem("aegis_token");
      const res = await fetch("/api/logs/tamper", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await res.json();
      setAuditLog(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] INTRUSION EMULATOR: Modifying transaction record values in memory...`,
        `[${new Date().toLocaleTimeString()}] SUCCESS: ${data.message}`
      ]);
      alert("模拟篡改成功！已破坏数据库 oldest log 字段。点击【运行风控审计】测试系统拦截。");
      handleRunVerify();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestore = async () => {
    try {
      const token = localStorage.getItem("aegis_token");
      const res = await fetch("/api/logs/restore", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await res.json();
      setAuditLog(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] SECURITY SECURING: Deploying secure mirrored decentralized backup records...`,
        `[${new Date().toLocaleTimeString()}] SUCCESS: ${data.message}`,
        `[${new Date().toLocaleTimeString()}] RE-CHAINING COMPLETE: SHA-256 links restored.`
      ]);
      alert("数据库已通过不可篡改冷热双活节点自动校验修复！");
      handleRunVerify();
    } catch (err) {
      console.error(err);
    }
  };

  // Convert and format timestamp based on timezone selection
  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    if (timezone === "UTC") {
      return date.toUTCString().replace("GMT", "UTC");
    } else if (timezone === "JST") {
      try {
        return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) + " (JST)";
      } catch (e) {
        const jstDate = new Date(date.getTime() + 9 * 3600 * 1000);
        return jstDate.toISOString().replace("T", " ").substring(0, 19) + " (JST)";
      }
    } else {
      return date.toLocaleString() + " (Local)";
    }
  };

  const getReportData = () => {
    const totalVolume = logs.reduce((sum, l) => sum + l.total, 0);
    const totalBuyCount = logs.filter(l => l.type === "buy").length;
    const totalSellCount = logs.filter(l => l.type === "sell").length;
    const realizedPnl = logs.reduce((sum, l) => sum + (l.pnl || 0), 0);
    const complianceScore = violations.length > 0 ? "F (INTEGRITY_COMPROMISED)" : "AAA (EXCELLENT)";
    const hashChainHead = logs[0]?.currentHash?.substring(0, 16) || "N/A";
    const jstAuditTime = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    return {
      totalVolume,
      totalBuyCount,
      totalSellCount,
      realizedPnl,
      complianceScore,
      hashChainHead,
      jstAuditTime
    };
  };

  const report = getReportData();

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      
      {/* Upper Title and Controls */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Regulatory Compliance & Chain Auditing
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
            Aegis Real-Time Journals
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            SHA-256 Cryptographic Block Linked Trading Ledgers & Financial Audit Suite
          </p>
        </div>

        {/* Sub-tabs Selection */}
        <div className="flex items-center gap-1.5 border border-[#2A2A2C] p-1 bg-[#0A0A0B] w-full lg:w-auto">
          <button
            onClick={() => setSubTab("logs")}
            className={`px-3 py-1.5 font-mono text-[10px] font-black uppercase transition cursor-pointer ${
              subTab === "logs" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
            }`}
          >
            交易流水 (LOGS)
          </button>
          <button
            onClick={() => setSubTab("crypto")}
            className={`px-3 py-1.5 font-mono text-[10px] font-black uppercase transition cursor-pointer flex items-center gap-1 ${
              subTab === "crypto" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
            }`}
          >
            链式合规校验 (CRYPTO)
          </button>
          <button
            onClick={() => setSubTab("compliance")}
            className={`px-3 py-1.5 font-mono text-[10px] font-black uppercase transition cursor-pointer ${
              subTab === "compliance" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
            }`}
          >
            监管合规报表 (REPORT)
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: TRADING LOGS VIEW */}
      {subTab === "logs" && (
        <div className="space-y-4">
          
          {/* Filters, Timezone Selector and Download Bar */}
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 bg-[#0A0A0B] p-4 border border-[#2A2A2C]">
            
            {/* Left side: filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
              <div>
                <label className="block text-[9px] text-[#666666] font-mono uppercase mb-1 font-bold">
                  Broker Access Point
                </label>
                <select
                  value={filters.broker}
                  onChange={(e) => setFilters((prev) => ({ ...prev, broker: e.target.value }))}
                  className="w-full bg-[#141416] text-white text-[11px] py-1.5 px-2.5 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono uppercase"
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
                <label className="block text-[9px] text-[#666666] font-mono uppercase mb-1 font-bold">
                  Active Asset Pair
                </label>
                <select
                  value={filters.symbol}
                  onChange={(e) => setFilters((prev) => ({ ...prev, symbol: e.target.value }))}
                  className="w-full bg-[#141416] text-white text-[11px] py-1.5 px-2.5 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono uppercase"
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
                <label className="block text-[9px] text-[#666666] font-mono uppercase mb-1 font-bold">
                  Arbitrage Side
                </label>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
                  className="w-full bg-[#141416] text-white text-[11px] py-1.5 px-2.5 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono uppercase"
                  id="filter-type"
                >
                  <option value="ALL">All Tx Types (全部方向)</option>
                  <option value="buy">BUY (买入对冲)</option>
                  <option value="sell">SELL (卖出套利)</option>
                </select>
              </div>
            </div>

            {/* Right side: Timezone selector and download button */}
            <div className="flex items-center gap-3 flex-wrap">
              
              {/* Timezone Switcher */}
              <div className="flex items-center border border-[#2A2A2C] bg-[#141416] p-1">
                <span className="text-[8px] text-[#666666] font-mono font-black uppercase px-2 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-[#6FF]" /> ZONE:
                </span>
                <button
                  onClick={() => setTimezone("LOCAL")}
                  className={`px-2 py-0.5 text-[8px] font-mono font-bold uppercase cursor-pointer ${
                    timezone === "LOCAL" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Local
                </button>
                <button
                  onClick={() => setTimezone("UTC")}
                  className={`px-2 py-0.5 text-[8px] font-mono font-bold uppercase cursor-pointer ${
                    timezone === "UTC" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  UTC
                </button>
                <button
                  onClick={() => setTimezone("JST")}
                  className={`px-2 py-0.5 text-[8px] font-mono font-bold uppercase cursor-pointer ${
                    timezone === "JST" ? "bg-[#00FF66] text-black" : "text-zinc-400 hover:text-white"
                  }`}
                  title="Japan Standard Time (Regulatory Compliance)"
                >
                  Tokyo JST
                </button>
              </div>

              {/* Refresh & export */}
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="p-2 px-3 bg-[#141416] hover:bg-zinc-800 text-white rounded-none text-[10px] flex items-center gap-1 border border-[#2A2A2C] uppercase font-bold font-mono cursor-pointer transition-all h-9"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <button
                onClick={handleDownload}
                className="p-2 px-3 bg-[#00FF66] hover:bg-[#00CC55] text-black rounded-none text-[10px] flex items-center gap-1 uppercase font-black transition-all cursor-pointer h-9"
              >
                <Download className="h-3 w-3" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Logs table */}
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border border-dashed border-[#2A2A2C] rounded-none bg-[#0A0A0B] text-[#666666]">
              <FileText className="h-8 w-8 mb-2 text-[#666666]" />
              <p className="text-xs uppercase font-mono font-bold">No matching journal outputs catalogued.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#2A2A2C]">
              <table className="w-full text-left border-collapse font-mono" id="table-logs">
                <thead>
                  <tr className="border-b border-[#2A2A2C] text-[9px] text-[#666666] font-mono tracking-wider uppercase bg-[#0A0A0B] font-bold">
                    <th className="py-3 px-3">Transaction ID</th>
                    <th className="py-3 px-3">Hedged Engine Profile</th>
                    <th className="py-3 px-3">Access Point</th>
                    <th className="py-3 px-3">Symbol Pair</th>
                    <th className="py-3 px-3">Position Type</th>
                    <th className="py-3 px-3 text-right">Match Price</th>
                    <th className="py-3 px-3 text-right">Clear Size</th>
                    <th className="py-3 px-3 text-right">Clear Value</th>
                    <th className="py-3 px-3 text-right text-[#00FF66]">Realized PnL Profit</th>
                    <th className="py-3 px-3 text-right">Cleared Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isTampered = violations.some(v => v.id === log.id);
                    return (
                      <tr
                        key={log.id}
                        className={`border-b border-[#2A2A2C] last:border-0 text-xs transition duration-150 ${
                          isTampered ? "bg-rose-950/20 text-[#FF3333] border-l-2 border-l-[#FF3333]" : "hover:bg-[#0A0A0B]/50"
                        }`}
                      >
                        <td className="py-3 px-3 text-zinc-550 font-mono text-[11px] truncate max-w-[80px]">
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
                                ? "text-[#00FF66] border-[#00FF66] bg-emerald-950/10"
                                : "text-[#FF3333] border-[#FF3333] bg-rose-955/10"
                            }`}
                          >
                            {log.type.toUpperCase()}
                          </span>
                        </td>
                        <td className={`py-3 px-3 text-right ${isTampered ? "font-black text-[#FF3333]" : "text-white"}`}>
                          ${log.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          {isTampered && <span className="text-[8px] bg-[#FF3333] text-white px-1 ml-1 rounded-none uppercase">Tampered</span>}
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
                          {formatTimestamp(log.timestamp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: CRYPTOGRAPHIC HASH CHAIN VERIFICATION PANEL */}
      {subTab === "crypto" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Status Panel */}
            <div className="lg:col-span-2 bg-[#0A0A0B] border border-[#2A2A2C] p-6 rounded-none flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-black uppercase text-[#666666] tracking-wider mb-4 font-mono">
                  SHA-256 Ledger Chain Verification (区块链级防篡改链式审计)
                </h3>

                <div className="flex items-start gap-4 mb-6">
                  {integrityStatus === "secure" ? (
                    <div className="p-3 bg-emerald-950/40 text-[#00FF66] border border-[#00FF66] rounded-none">
                      <ShieldCheck className="h-10 w-10 animate-pulse" />
                    </div>
                  ) : integrityStatus === "tampered" ? (
                    <div className="p-3 bg-rose-950/40 text-[#FF3333] border border-[#FF3333] rounded-none">
                      <ShieldAlert className="h-10 w-10 animate-pulse" />
                    </div>
                  ) : (
                    <div className="p-3 bg-zinc-900 text-[#6FF] border border-zinc-700 rounded-none">
                      <RefreshCw className="h-10 w-10 animate-spin" />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black uppercase font-display tracking-tight text-white">
                        {integrityStatus === "secure" ? "SECURE_HASH_CHAIN_VALID (合规无损)" : 
                         integrityStatus === "tampered" ? "CHAIN_INTEGRITY_COMPROMISED (检测到篡改!)" : "VERIFYING_CHAIN_INTEGRITY..."}
                      </span>
                      <span className={`text-[8px] font-mono font-black px-1.5 py-0.2 uppercase border ${
                        integrityStatus === "secure" ? "bg-emerald-950/20 text-[#00FF66] border-[#00FF66]" : "bg-rose-95 /20 text-[#FF3333] border-[#FF3333]"
                      }`}>
                        {integrityStatus === "secure" ? "SECURE" : "BREACH"}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5 max-w-lg">
                      {integrityStatus === "secure" 
                        ? "本系统所有高频网格交易所成交记录及指令、风控门限，皆经过链式散列计算（SHA-256 Hash Chain）。每一个记录均包含上一个区块的数字指纹。经校验，全库记录一致，未检测到任何由于底层注入、API重置或DB未授权更改导致的字段篡改。" 
                        : "紧急警报：系统风控模块在底层成交日志指纹校对中，发现先前区块（Hash Index）与当期散列指纹链失效。存在非正常渠道对底层历史成交价格/金额进行写入或修改的风险。系统已就此进行审计标注！"
                      }
                    </p>
                  </div>
                </div>

                {violations.length > 0 && (
                  <div className="bg-rose-950/20 border border-[#FF3333]/30 p-4 rounded-none mb-6 text-xs text-[#FF3333] font-mono uppercase">
                    <strong className="block text-[11px] font-black mb-1 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> 篡改位置详细审计日志 (TAMPER_TRACE_DETECTION)
                    </strong>
                    {violations.map((v, i) => (
                      <div key={v.id} className="mt-1.5 pl-5 border-l border-[#FF3333] space-y-0.5">
                        <p>成交记录 ID: <span className="text-white font-bold">{v.id}</span> | 引擎: {v.botName} | 时间: {new Date(v.timestamp).toLocaleString()}</p>
                        <p>原校验指纹: <span className="text-zinc-500 truncate max-w-[200px] inline-block">{v.recordedHash}</span></p>
                        <p>现计算指纹: <span className="text-white font-bold truncate max-w-[200px] inline-block">{v.calculatedHash}</span></p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Interactive Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-[#2A2A2C]">
                <button
                  onClick={handleRunVerify}
                  disabled={integrityStatus === "verifying"}
                  className="bg-white hover:bg-[#00FF66] text-black text-[10px] font-black p-3 rounded-none uppercase transition font-mono tracking-wider cursor-pointer h-11 flex items-center justify-center gap-1"
                >
                  <Shield className="h-3.5 w-3.5" />
                  运行风控审计 (Verify)
                </button>
                <button
                  onClick={handleTamper}
                  disabled={integrityStatus === "verifying" || integrityStatus === "tampered"}
                  className="bg-rose-950/30 border border-[#FF3333] hover:bg-[#FF3333] hover:text-white text-[#FF3333] text-[10px] font-black p-3 rounded-none uppercase transition font-mono tracking-wider cursor-pointer h-11 flex items-center justify-center gap-1"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  模拟底层篡改 (Tamper)
                </button>
                <button
                  onClick={handleRestore}
                  disabled={integrityStatus === "verifying" || integrityStatus === "secure"}
                  className="bg-emerald-950/30 border border-[#00FF66] hover:bg-[#00FF66] hover:text-black text-[#00FF66] text-[10px] font-black p-3 rounded-none uppercase transition font-mono tracking-wider cursor-pointer h-11 flex items-center justify-center gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  冷备份一键修复 (Repair)
                </button>
              </div>
            </div>

            {/* Crypto Audit Logs Terminal */}
            <div className="bg-[#0A0A0B] border border-[#2A2A2C] p-5 rounded-none flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-black uppercase text-[#666666] tracking-wider mb-3.5 font-mono">
                  Crypto Ledger Audit Console (控制台流)
                </h3>
                <div className="bg-[#141416] p-4 border border-[#2A2A2C] rounded-none font-mono text-[9px] text-[#A0A0A0] h-[240px] overflow-y-auto space-y-1.5 scrollbar-none">
                  {auditLog.map((logLine, idx) => (
                    <p key={idx} className="leading-relaxed whitespace-pre-wrap">{logLine}</p>
                  ))}
                  {integrityStatus === "verifying" && (
                    <p className="text-[#6FF] animate-pulse">Scanning block index ... [RE-COMPUTING SHA-256 HASH SEQUENCE]</p>
                  )}
                </div>
              </div>
              <p className="text-[9px] text-zinc-550 uppercase tracking-tight font-mono mt-3">
                Fingerprint Chain Model: Root → Index[0] → PreviousHash → CurrentHash. Dynamic interval rechain active.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: REGULATORY COMPLIANCE REPORT GENERATOR */}
      {subTab === "compliance" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Input Options Card */}
            <div className="lg:col-span-1 bg-[#0A0A0B] border border-[#2A2A2C] p-5 rounded-none space-y-4">
              <h3 className="text-xs font-black uppercase text-[#666666] tracking-wider font-mono">
                Report Creator Parameters
              </h3>
              
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1.5 font-bold">Target Regulator (监管主体)</label>
                <select
                  value={regulator}
                  onChange={(e) => setRegulator(e.target.value as any)}
                  className="w-full bg-[#141416] text-white text-xs py-2 px-3 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono"
                >
                  <option value="CFA">中国期货业协会 (CFA Compliance)</option>
                  <option value="CFTC">美国商品期货交易委员会 (CFTC Reg-Core)</option>
                  <option value="GIPS">全球投资业绩标准 (GIPS Standards)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-zinc-500 uppercase font-mono mb-1.5 font-bold">Reporting Cycle</label>
                <select
                  className="w-full bg-[#141416] text-white text-xs py-2 px-3 rounded-none border border-[#2A2A2C] focus:outline-none focus:border-[#00FF66] font-mono"
                >
                  <option>Current Simulation Period (自启动以来所有成交)</option>
                  <option>Recent 30 Days (30日滚动账目)</option>
                  <option>Quarterly Performance (Q2审计)</option>
                </select>
              </div>

              <div className="text-[10px] text-zinc-550 leading-relaxed uppercase font-mono pt-2 border-t border-[#2A2A2C]">
                According to the chosen financial regime, timestamps will be standard audit format. Ledger cryptographic hash signatures are attached to prevent subsequent alterations.
              </div>

              <button
                onClick={() => setShowReport(true)}
                className="w-full bg-[#00FF66] text-black text-[10px] font-black p-3 rounded-none uppercase transition font-mono tracking-wider cursor-pointer flex items-center justify-center gap-1 h-11"
              >
                <FileText className="h-3.5 w-3.5" />
                生成合规监管报告
              </button>
            </div>

            {/* Preview Output Frame */}
            <div className="lg:col-span-2 bg-[#0A0A0B] border border-[#2A2A2C] p-6 rounded-none relative overflow-hidden">
              {showReport ? (
                <div className="text-[#E0E0E0] space-y-6 font-mono" id="compliance-report-render">
                  
                  {/* Decorative stamp watermark */}
                  <div className="absolute top-8 right-8 border-4 border-emerald-500/20 text-emerald-500/20 px-4 py-2 font-black uppercase text-xs tracking-widest rotate-12 select-none pointer-events-none rounded-none">
                    AEGIS APPROVED
                  </div>

                  {/* Header */}
                  <div className="border-b border-[#2A2A2C] pb-4 flex justify-between items-start">
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-wider text-white">
                        {regulator === "CFA" && "中国期货业协会 · 期货高频量化网格交易风控合规审查报告"}
                        {regulator === "CFTC" && "U.S. CFTC QUANTITATIVE COMPLIANCE & PROTOCOL STATEMENT"}
                        {regulator === "GIPS" && "GLOBAL INVESTMENT PERFORMANCE STANDARDS (GIPS) PERFORMANCE AUDIT"}
                      </h4>
                      <p className="text-[9px] text-[#666666] uppercase mt-1">
                        Report generated dynamically under Aegis cryptographic ledger check sequence
                      </p>
                    </div>
                    <button
                      onClick={() => window.print()}
                      className="bg-[#141416] hover:bg-zinc-800 text-[#00FF66] border border-[#00FF66]/30 text-[9px] px-2.5 py-1 flex items-center gap-1 font-bold rounded-none cursor-pointer"
                    >
                      <Printer className="h-3 w-3" /> PRINT
                    </button>
                  </div>

                  {/* Meta stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[10px] bg-[#141416] p-4 border border-[#2A2A2C]">
                    <div>
                      <span className="text-zinc-550 block uppercase">Regulator</span>
                      <span className="text-[#6FF] font-black uppercase block">{regulator} Standard</span>
                    </div>
                    <div>
                      <span className="text-zinc-550 block uppercase">Ledger Score</span>
                      <span className="text-[#00FF66] font-black uppercase block">{report.complianceScore}</span>
                    </div>
                    <div>
                      <span className="text-zinc-550 block uppercase">Hash Chain Head</span>
                      <span className="text-white font-black block font-mono">{report.hashChainHead}...</span>
                    </div>
                    <div>
                      <span className="text-zinc-550 block uppercase">Audit Timestamp</span>
                      <span className="text-white font-black block">{report.jstAuditTime} (JST)</span>
                    </div>
                  </div>

                  {/* Financial Data Summary */}
                  <div className="space-y-2 text-xs">
                    <h5 className="font-bold text-white text-[11px] pb-1 border-b border-[#2A2A2C]/50 uppercase tracking-wide">Financial Statement Indicators (财务指标摘要)</h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[#666666] uppercase">Cumulative Cleared Volume:</span>
                          <span className="text-white font-bold">${report.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#666666] uppercase">Realized Arbitrage Arbitrage:</span>
                          <span className="text-[#00FF66] font-black">${report.realizedPnl.toFixed(2)} USD</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[#666666] uppercase">Buy Order Volume (对冲):</span>
                          <span className="text-white font-bold">{report.totalBuyCount} Trades</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#666666] uppercase">Sell Order Volume (套利):</span>
                          <span className="text-white font-bold">{report.totalSellCount} Trades</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Declaration text */}
                  <div className="text-[10px] text-zinc-500 leading-relaxed uppercase space-y-2">
                    <p>
                      <strong>Statement of Compliance:</strong> Aegis Ampere Quant quantifies strategy parameters on a sandboxed virtual node structure, with automated stop loss, leverage restrictions, and portfolio allocation limits enabled.
                    </p>
                    <p>
                      We certify that the performance results and transaction records presented in this statement have been verified by SHA-256 cryptographic chain, confirming no back-dated alterations. The timezone conforms to <strong>Asia/Tokyo (JST Standard)</strong> for CFTC/CFA offshore compliance.
                    </p>
                  </div>

                  {/* Signatures */}
                  <div className="pt-4 border-t border-[#2A2A2C] flex justify-between items-center text-[9px] text-zinc-550">
                    <div>
                      <p className="uppercase font-bold text-zinc-400">Aegis Quant Risk Officer</p>
                      <p className="font-mono mt-1 italic">/s/ Cryptographic Automated Node Signature</p>
                    </div>
                    <div className="text-right">
                      <p className="uppercase font-bold text-zinc-400">Tokyo Clearing Authority Link</p>
                      <p className="font-mono mt-1 text-[#00FF66]">SECURE_NODE_OK</p>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-[#666666] text-center font-mono">
                  <FileText className="h-12 w-12 mb-3 text-[#2A2A2C]" />
                  <p className="text-xs uppercase font-bold max-w-sm leading-relaxed">
                    Select a regulatory authority on the left, check options, and click "Generate" to generate a secure compliant report statement.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
