import React, { useState, useEffect } from "react";
import { Cpu, HardDrive, RefreshCw, Thermometer, ShieldAlert } from "lucide-react";
import { systemOverview } from "../types";

export default function SystemMetrics() {
  const [metrics, setMetrics] = useState<systemOverview>({
    cpuUsage: 12.4,
    memoryUsage: 36.1,
    diskUsage: 24.8,
    uptime: "7 days, 14 hours, 32 minutes",
    ampereTemp: 42.5,
    coreStatus: "Active",
  });
  const [loading, setLoading] = useState(false);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/overview");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // 10s updates
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-[#2A2A2C]">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Core Diagnostics Panel
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
            Aegis Telemetry Node
          </h2>
        </div>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="px-3 py-1.5 hover:bg-neutral-800 text-slate-350 hover:text-white rounded-none transition duration-200 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 border border-[#2A2A2C] bg-[#0A0A0B]"
          id="btn-refresh-metrics"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Core
        </button>
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
  );
}
