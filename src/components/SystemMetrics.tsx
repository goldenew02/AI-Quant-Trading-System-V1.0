import React, { useState, useEffect } from "react";
import { Cpu, HardDrive, RefreshCw, Thermometer, ShieldAlert, AlertTriangle, ShieldCheck, Clock } from "lucide-react";
import { systemOverview } from "../types";
import { apiFetch } from "../lib/api";

export default function SystemMetrics() {
  const [metrics, setMetrics] = useState<systemOverview>({
    cpuUsage: 12.4,
    memoryUsage: 36.1,
    diskUsage: 24.8,
    uptime: "7 days, 14 hours, 32 minutes",
    ampereTemp: 42.5,
    coreStatus: "Active",
    apiRequestRate: 0,
    rateLimitCap: 120,
    circuitBreakerActive: false,
  });
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [overloadMessage, setOverloadMessage] = useState<string | null>(null);

  // Timezone selection for system auditing
  const [selectedTimezone, setSelectedTimezone] = useState<"JST" | "UTC">("UTC");
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/overview");
      if (res.status === 429) {
        let errMsg = "Too Many Requests - Circuit Breaker Triggered.";
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            errMsg = data.error || errMsg;
          } else {
            const textMsg = await res.text();
            if (textMsg) errMsg = textMsg;
          }
        } catch (parseErr) {
          console.warn("Failed to parse 429 response body:", parseErr);
        }

        setMetrics(prev => ({
          ...prev,
          apiRequestRate: 125,
          circuitBreakerActive: true,
        }));
        setOverloadMessage(errMsg);
        return;
      }

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setMetrics(data);
        if (!data.circuitBreakerActive) {
          setOverloadMessage(null);
        }
      }
    } catch (err) {
      console.error("Error fetching overview metrics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 4000); // More frequent polling to catch rate-limits
    
    // Ticking clock
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(clockInterval);
    };
  }, []);

  const formatClock = () => {
    if (selectedTimezone === "JST") {
      // JST is UTC + 9
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstDate = new Date(currentTime.getTime() + currentTime.getTimezoneOffset() * 60 * 1000 + jstOffset);
      return jstDate.toLocaleTimeString("zh-CN", { hour12: false }) + " Tokyo (JST)";
    } else {
      return currentTime.toISOString().substring(11, 19) + " UTC";
    }
  };

  const handleSimulateOverload = async () => {
    try {
      setSimulating(true);
      setOverloadMessage("Sending 130 high-frequency parallel requests to overload the safety circuits...");
      
      // Perform 130 requests concurrently
      const requests = Array.from({ length: 130 }).map(() =>
        apiFetch("/api/overview").catch(() => null)
      );
      
      await Promise.all(requests);
      
      // Refetch to capture the circuit breaker status immediately
      await fetchMetrics();
    } catch (e) {
      console.error(e);
    } finally {
      setSimulating(false);
    }
  };

  const handleResetOverload = async () => {
    try {
      setLoading(true);
      // Let's send a request to a non-existent API or restore on the server
      setOverloadMessage(null);
      // Wait for interval to reset server counters
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const ratePercent = Math.min(((metrics.apiRequestRate || 0) / (metrics.rateLimitCap || 120)) * 100, 100);
  const isCB = metrics.circuitBreakerActive;

  return (
    <div className="space-y-6">
      
      {/* Dynamic Telemetry & JST timezone converter card */}
      <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 text-[#E0E0E0] shadow-none">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
          <div>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
              Core Diagnostics Panel & Clock
            </span>
            <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
              Aegis Telemetry Node
            </h2>
          </div>
          
          <div className="flex items-center gap-4 self-stretch sm:self-auto flex-wrap sm:flex-nowrap">
            {/* Clock converter UI */}
            <div className="bg-[#0A0A0B] border border-[#2A2A2C] px-3 py-1 flex items-center gap-2 text-xs font-mono">
              <Clock className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-white font-bold">{formatClock()}</span>
              <select
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value as "JST" | "UTC")}
                className="bg-transparent text-[#00FF66] border-0 outline-none cursor-pointer text-xs font-black"
              >
                <option value="UTC" className="bg-[#141416] text-white">UTC</option>
                <option value="JST" className="bg-[#141416] text-white">JST (东京时间)</option>
              </select>
            </div>

            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="px-3 py-1.5 hover:bg-neutral-800 text-slate-350 hover:text-white rounded-none transition duration-200 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 border border-[#2A2A2C] bg-[#0A0A0B] cursor-pointer"
              id="btn-refresh-metrics"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh Core
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {/* CPU */}
          <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]" id="metric-cpu">
            <div className="flex justify-between items-center mb-2 text-[#666666]">
              <span className="text-[10px] font-bold uppercase tracking-wider">CPU / A1 Compute</span>
              <Cpu className="h-4 w-4 text-[#00FF66]" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black font-mono tracking-tighter text-[#00FF66]">
                {metrics.cpuUsage}%
              </span>
              <span className="text-[10px] text-[#666666] font-mono uppercase">load</span>
            </div>
            <div className="w-full bg-[#141416] h-1 rounded-none mt-3.5 overflow-hidden">
              <div
                className="bg-[#00FF66] h-full transition-all duration-500"
                style={{ width: `${Math.min(100, metrics.cpuUsage)}%` }}
              />
            </div>
          </div>

          {/* Memory */}
          <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]" id="metric-ram">
            <div className="flex justify-between items-center mb-2 text-[#666666]">
              <span className="text-[10px] font-bold uppercase tracking-wider">RAM Allocation</span>
              <HardDrive className="h-4 w-4 text-[#0066FF]" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black font-mono tracking-tighter text-white">
                {metrics.memoryUsage}%
              </span>
              <span className="text-[10px] text-[#666666] font-mono uppercase">
                {Math.round((12 * metrics.memoryUsage) / 100)}GB / 12GB
              </span>
            </div>
            <div className="w-full bg-[#141416] h-1 rounded-none mt-3.5 overflow-hidden">
              <div
                className="bg-[#0066FF] h-full transition-all duration-500"
                style={{ width: `${metrics.memoryUsage}%` }}
              />
            </div>
          </div>

          {/* Temperature */}
          <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]" id="metric-temp">
            <div className="flex justify-between items-center mb-2 text-[#666666]">
              <span className="text-[10px] font-bold uppercase tracking-wider">Thermal Junction</span>
              <Thermometer className="h-4 w-4 text-[#FF3333]" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black font-mono tracking-tighter text-[#E0E0E0]">
                {metrics.ampereTemp}°C
              </span>
              <span className="text-[10px] text-[#00FF66] font-mono uppercase">nominal</span>
            </div>
            <div className="w-full bg-[#141416] h-1 rounded-none mt-3.5 overflow-hidden">
              <div
                className="bg-[#FF3333] h-full transition-all duration-500"
                style={{ width: `${(metrics.ampereTemp / 90) * 100}%` }}
              />
            </div>
          </div>

          {/* Disk & Uptime */}
          <div className="bg-[#0A0A0B] p-4 rounded-none border border-[#2A2A2C]" id="metric-uptime">
            <div className="flex justify-between items-center mb-2 text-[#666666]">
              <span className="text-[10px] font-bold uppercase tracking-wider">SSD / Active Uptime</span>
              <ShieldAlert className="h-4 w-4 text-[#E0E0E0]" />
            </div>
            <p className="text-[10px] text-white font-mono uppercase font-bold tracking-tight mb-2 truncate">
              {metrics.uptime}
            </p>
            <div className="flex justify-between items-center text-[10px] text-[#666666] font-mono border-t border-[#141416] pt-2">
              <span>Disk Use</span>
              <span className="text-[#E0E0E0]">{metrics.diskUsage}GB / 100GB</span>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Circuit Breaker and Overload Simulation Deck */}
      <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 text-[#E0E0E0]">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#2A2A2C]">
          <h3 className="text-xs font-black uppercase text-[#666666] tracking-wider font-mono">
            API Load Compliance & safety Circuit Breaker (API负载与熔断监控)
          </h3>
          
          <div className="flex items-center gap-2">
            {isCB ? (
              <span className="flex items-center gap-1 text-[#FF3333] font-mono text-xs uppercase font-black bg-[#FF3333]/15 px-2.5 py-1 animate-pulse border border-[#FF3333]">
                <AlertTriangle className="h-3.5 w-3.5" />
                ⚡ Circuit Breaker Engaged (已触发风控熔断)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[#00FF66] font-mono text-xs uppercase font-black bg-[#00FF66]/10 px-2.5 py-1 border border-[#00FF66]">
                <ShieldCheck className="h-3.5 w-3.5" />
                ✔ API Load Steady (接口负载正常)
              </span>
            )}
          </div>
        </div>

        {overloadMessage && (
          <div className="bg-[#FF3333]/10 border border-[#FF3333] text-[#FF3333] p-4 text-xs font-mono uppercase leading-relaxed mb-4">
            <strong className="block text-sm font-black mb-1">HTTP ERROR 429 - TOO MANY REQUESTS</strong>
            {overloadMessage}
            <div className="text-[10px] text-zinc-500 mt-2">
              Note: The safety circuit reset is automated. Request rate count will refresh in 60s window reset.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          
          {/* Rate Limit stats progress bar */}
          <div className="md:col-span-2 space-y-2 bg-[#0A0A0B] p-4 border border-[#2A2A2C]">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#666666] uppercase font-bold">Current Sliding API Request Frequency Rate:</span>
              <span className={`font-bold ${isCB ? "text-[#FF3333] font-black" : "text-white"}`}>
                {metrics.apiRequestRate || 0} / {metrics.rateLimitCap || 120} req/min
              </span>
            </div>
            
            <div className="w-full bg-[#141416] h-3 rounded-none overflow-hidden relative border border-[#2A2A2C]">
              <div
                className={`h-full transition-all duration-300 ${isCB ? "bg-[#FF3333]" : "bg-[#00FF66]"}`}
                style={{ width: `${ratePercent}%` }}
              ></div>
            </div>
            
            <div className="text-[10px] text-zinc-550 font-mono uppercase leading-relaxed">
              Sliding frequency limiter blocks DDOS overload or high-frequency automated trading scripts that violate API limits. Triggering prevents core container exhaustion.
            </div>
          </div>

          {/* Attack simulation buttons panel */}
          <div className="bg-[#0A0A0B] p-4 border border-[#2A2A2C] flex flex-col justify-between h-full">
            <div>
              <span className="text-[10px] text-[#666666] font-mono uppercase font-black block mb-2">Simulate Overload Attack</span>
              <p className="text-[10px] text-zinc-500 font-mono uppercase leading-normal mb-4">
                Launch 130 asynchronous parallel API requests in milliseconds to force frequency limits threshold.
              </p>
            </div>

            <button
              onClick={handleSimulateOverload}
              disabled={simulating}
              className="w-full bg-[#FF3333] hover:bg-[#CC2222] text-white text-xs font-black py-2 px-4 rounded-none uppercase transition duration-150 cursor-pointer flex items-center justify-center gap-1.5 font-display"
            >
              {simulating ? (
                <>
                  <RefreshCw className="animate-spin h-3.5 w-3.5" />
                  ATTACKING PORTS...
                </>
              ) : (
                "LAUNCH API OVERLOAD SHOCK"
              )}
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
