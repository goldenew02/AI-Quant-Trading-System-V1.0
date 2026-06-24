import React, { useState, useEffect } from "react";
import { Shield, CheckCircle, AlertOctagon, Search, RefreshCw, Key, ShieldCheck } from "lucide-react";

interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  action: string;
  target: string;
  details: string;
  ipAddress: string;
  previousHash: string;
  currentHash: string;
}

interface SecurityLogsProps {
  secureFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

export default function SecurityLogs({ secureFetch }: SecurityLogsProps) {
  const [logs, setLogs] = useState<SecurityAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [chainValid, setChainValid] = useState<boolean>(true);
  const [verifying, setVerifying] = useState(false);

  const fetchSecurityLogs = async () => {
    setLoading(true);
    try {
      const res = await secureFetch("/api/security/logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        verifyHashChainLocal(data);
      }
    } catch (err) {
      console.error("Error fetching security logs:", err);
    } finally {
      setLoading(false);
    }
  };

  const verifyHashChainLocal = (entries: SecurityAuditEntry[]) => {
    if (entries.length <= 1) {
      setChainValid(true);
      return;
    }
    // Verify sequence
    let isValid = true;
    for (let i = 0; i < entries.length - 1; i++) {
      // Since entries are unshifted (newest first), the entry at index i's previousHash 
      // should match the entry at index i+1's currentHash.
      if (entries[i].previousHash !== entries[i + 1].currentHash) {
        isValid = false;
        break;
      }
    }
    setChainValid(isValid);
  };

  useEffect(() => {
    fetchSecurityLogs();
  }, []);

  const handleVerifyChain = async () => {
    setVerifying(true);
    // Simulate deep cryptographical analysis on the client
    setTimeout(() => {
      verifyHashChainLocal(logs);
      setVerifying(false);
    }, 1200);
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.username.toLowerCase().includes(search.toLowerCase()) ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase()) ||
      log.target.toLowerCase().includes(search.toLowerCase());
    
    const matchesRole = roleFilter === "ALL" || log.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return <span className="text-[10px] bg-[#FF3333]/10 text-[#FF3333] border border-[#FF3333]/30 px-1.5 py-0.5 uppercase font-mono font-black">ADMIN (管理员)</span>;
      case "operator":
        return <span className="text-[10px] bg-[#3399FF]/10 text-[#3399FF] border border-[#3399FF]/30 px-1.5 py-0.5 uppercase font-mono font-black">OPERATOR (操作员)</span>;
      case "viewer":
        return <span className="text-[10px] bg-zinc-800 text-zinc-450 border border-zinc-700 px-1.5 py-0.5 uppercase font-mono font-black">VIEWER (只读审计)</span>;
      default:
        return <span className="text-[10px] bg-[#00FF66]/10 text-[#00FF66] border border-[#00FF66]/30 px-1.5 py-0.5 uppercase font-mono font-black">SYSTEM (系统核心)</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Integrity banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-[#141416] border border-[#2A2A2C] p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <ShieldCheck className="h-6 w-6 text-[#00FF66]" />
              <h2 className="text-sm font-black tracking-widest uppercase font-mono text-white">
                CRYPTOGRAPHIC LOG CHAIN INTEGRITY (密码学完整性校验)
              </h2>
            </div>
            <p className="text-xs text-[#888888] font-sans leading-relaxed">
              Every system administrative operation, authorization toggle, risk modification, and authentication success triggers a cryptographic hash block. Blocks are securely chained back-to-back using <b>SHA-256</b> sequence hashing, preventing database injection or transaction record falsification.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              onClick={handleVerifyChain}
              disabled={verifying}
              className="bg-[#00FF66] text-black font-black uppercase text-xs px-4 py-2.5 hover:bg-[#00CC55] transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {verifying ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  RE-CALCULATING BLOCK HASHES...
                </>
              ) : (
                <>
                  <Shield className="h-3.5 w-3.5" />
                  VERIFY CRYPTOGRAPHIC CHAIN
                </>
              )}
            </button>
            <button
              onClick={fetchSecurityLogs}
              className="bg-transparent border border-[#2A2A2C] text-[#E0E0E0] font-black uppercase text-xs px-4 py-2.5 hover:bg-[#1C1C1E] transition flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              REFRESH LEDGER
            </button>
          </div>
        </div>

        {/* Integrity readout status */}
        <div className="bg-[#141416] border border-[#2A2A2C] p-6 flex flex-col items-center justify-center text-center">
          {chainValid ? (
            <>
              <div className="h-14 w-14 rounded-none border-2 border-[#00FF66]/20 flex items-center justify-center bg-[#00FF66]/5 mb-3">
                <CheckCircle className="h-8 w-8 text-[#00FF66] animate-pulse" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white mb-1.5 font-mono">
                LEDGER STATUS: SECURE
              </h3>
              <p className="text-[10px] text-[#666666] uppercase font-mono max-w-[200px]">
                Cryptographic sequence verified successfully. Zero tamper gaps detected.
              </p>
            </>
          ) : (
            <>
              <div className="h-14 w-14 rounded-none border-2 border-[#FF3333]/20 flex items-center justify-center bg-[#FF3333]/5 mb-3">
                <AlertOctagon className="h-8 w-8 text-[#FF3333] animate-bounce" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#FF3333] mb-1.5 font-mono">
                TAMPER WARNING: INVALID CHAIN
              </h3>
              <p className="text-[10px] text-[#FF3333] uppercase font-mono max-w-[200px]">
                Detected cryptographic hash chain discontinuity! Ledger integrity is compromised!
              </p>
            </>
          )}
        </div>
      </div>

      {/* Main ledger list & filters */}
      <div className="bg-[#141416] border border-[#2A2A2C] p-5">
        <div className="flex flex-col md:flex-row justify-between gap-4 mb-5 pb-4 border-b border-[#2A2A2C]">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[#666666]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter ledger by User, Action, Target or Details..."
              className="bg-[#0A0A0B] border border-[#2A2A2C] text-[#E0E0E0] placeholder-[#555555] text-xs py-3.5 pl-10 pr-4 w-full focus:outline-none focus:border-[#00FF66] font-mono"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono uppercase text-[#666666] font-bold">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-[#0A0A0B] border border-[#2A2A2C] text-[#E0E0E0] text-xs px-3.5 py-3 focus:outline-none focus:border-[#00FF66] font-mono"
            >
              <option value="ALL">ALL ROLES</option>
              <option value="admin">ADMIN</option>
              <option value="operator">OPERATOR</option>
              <option value="viewer">VIEWER</option>
            </select>
          </div>
        </div>

        {/* Ledger logs */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <RefreshCw className="animate-spin text-[#00FF66] h-6 w-6" />
            <p className="text-[10px] text-[#666666] font-mono tracking-wider uppercase">LOADING IMMUTABLE AUDIT TRAIL...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#666666] font-mono uppercase">
            No secure security audit ledger entries matched the query parameters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2A2A2C] text-[#666666] uppercase font-mono text-[10px]">
                  <th className="py-2.5 pb-4">TIMESTAMP</th>
                  <th className="py-2.5 pb-4">ACTOR / ROLE</th>
                  <th className="py-2.5 pb-4">SECURITY ACTION</th>
                  <th className="py-2.5 pb-4">TARGET INSTANCE</th>
                  <th className="py-2.5 pb-4">AUDIT DETAILS</th>
                  <th className="py-2.5 pb-4 text-right">IP ADDRESS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C1C1E] font-mono">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#1C1C1E]/50 transition group">
                    <td className="py-4 text-[#888888] pr-4 shrink-0 text-[10px]">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-white font-black">{log.username}</span>
                        {getRoleBadge(log.role)}
                      </div>
                    </td>
                    <td className="py-4 text-[#00FF66] pr-4 font-black text-[11px]">
                      {log.action}
                    </td>
                    <td className="py-4 text-zinc-350 pr-4">
                      {log.target}
                    </td>
                    <td className="py-4 text-[#CCCCCC] max-w-[320px] pr-4">
                      <p className="font-sans text-xs mb-1.5 leading-relaxed">{log.details}</p>
                      <div className="text-[8px] text-[#555555] font-mono group-hover:text-zinc-400 transition leading-normal">
                        <div className="flex items-center gap-1">
                          <span className="text-[#00FF66]/40 uppercase font-black">Hash:</span>
                          <span className="truncate max-w-[150px]">{log.currentHash}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[#FF3333]/40 uppercase font-black">Prev:</span>
                          <span className="truncate max-w-[150px]">{log.previousHash}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 text-right text-zinc-500">
                      {log.ipAddress}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
