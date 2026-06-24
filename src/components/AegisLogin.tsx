import React, { useState } from "react";
import { ShieldAlert, Key, HelpCircle, RefreshCw, Cpu, User, Lock, Terminal } from "lucide-react";

interface AegisLoginProps {
  onLoginSuccess: (token: string, role: 'admin' | 'operator' | 'viewer', username: string) => void;
}

export default function AegisLogin({ onLoginSuccess }: AegisLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError("Please fill in both telemetry access credentials.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        onLoginSuccess(data.token, data.role, data.username);
      } else {
        const data = await res.json();
        setError(data.error || "Authentication failed. ACCESS SHIELDED.");
      }
    } catch (err) {
      console.error(err);
      setError("Unable to connect to Aegis Core Server. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    // Submit login with short timeout to let the state update
    setTimeout(() => {
      setError(null);
      setLoading(true);
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            onLoginSuccess(data.token, data.role, data.username);
          } else {
            setError(data.error || "Verification failed");
          }
        })
        .catch(() => setError("Network communication failure"))
        .finally(() => setLoading(false));
    }, 100);
  };

  return (
    <div className="min-h-screen bg-[#060608] flex items-center justify-center p-4 selection:bg-[#00FF66]/20 selection:text-[#00FF66]">
      {/* Visual Ambient Cyber Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#141416_1px,transparent_1px),linear-gradient(to_bottom,#141416_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none"></div>

      <div className="w-full max-w-md bg-[#0D0D11] border border-[#2A2A2C] rounded-none relative z-10 shadow-2xl p-6 md:p-8">
        
        {/* Glowing safety lock icon */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 rounded-none border border-[#00FF66] bg-[#00FF66]/10 flex items-center justify-center mb-4 relative group">
            <ShieldAlert className="h-7 w-7 text-[#00FF66] animate-pulse" />
            <div className="absolute inset-0 border border-[#00FF66] animate-ping opacity-25"></div>
          </div>
          <h2 className="text-lg font-black tracking-[0.2em] font-display text-white uppercase italic">
            AEGIS SECURITY PROTOCOL
          </h2>
          <p className="text-[10px] text-[#666666] font-mono tracking-widest uppercase font-black mt-1">
            ARM Execution Core Authorization Shield v2.4
          </p>
        </div>

        {/* System Error Message */}
        {error && (
          <div className="bg-[#FF3333]/15 border border-[#FF3333] text-[#FF3333] p-3 text-xs font-mono uppercase rounded-none mb-6">
            <strong className="block text-[10px] font-black tracking-wider mb-0.5">⚠️ SECURE CRITICAL ERROR:</strong>
            {error}
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1.5">
              Access Token Username
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 h-4 w-4 text-[#444446]" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter operator username..."
                disabled={loading}
                className="bg-[#060608] border border-[#2A2A2C] text-white placeholder-[#444446] text-xs py-3.5 pl-11 pr-4 w-full focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1.5">
              Cryptographic Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-[#444446]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password sequence..."
                disabled={loading}
                className="bg-[#060608] border border-[#2A2A2C] text-white placeholder-[#444446] text-xs py-3.5 pl-11 pr-4 w-full focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#00FF66] text-black font-black uppercase text-xs tracking-wider py-4 hover:bg-[#00CC55] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                VERIFYING DIGITAL KEY...
              </>
            ) : (
              <>
                <Key className="h-4 w-4 text-black" />
                AUTHORIZE TERMINAL INTERACTION
              </>
            )}
          </button>
        </form>

        {/* Separator */}
        <div className="relative flex py-5 items-center">
          <div className="flex-grow border-t border-[#1C1C1E]"></div>
          <span className="flex-shrink mx-3 text-[9px] font-mono text-[#555557] font-black uppercase tracking-widest">
            SIMULATION QUICK LOGINS
          </span>
          <div className="flex-grow border-t border-[#1C1C1E]"></div>
        </div>

        {/* Interactive Testing Selector buttons */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => handleQuickLogin("admin", "aegisquant2026")}
            disabled={loading}
            className="w-full bg-zinc-950/20 border border-[#FF3333]/35 hover:bg-[#FF3333]/10 text-[#FF3333] py-2.5 px-4 font-mono text-[10px] uppercase font-black transition flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Cpu className="h-3 w-3 text-[#FF3333]" />
              ADMINISTRATOR (管理员)
            </span>
            <span className="text-[8px] text-[#FF3333]/50 font-bold">FULL PRIVILEGE</span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickLogin("operator", "operator2026")}
            disabled={loading}
            className="w-full bg-zinc-950/20 border border-[#3399FF]/35 hover:bg-[#3399FF]/10 text-[#3399FF] py-2.5 px-4 font-mono text-[10px] uppercase font-black transition flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Terminal className="h-3 w-3 text-[#3399FF]" />
              STRATEGY OPERATOR (操作员)
            </span>
            <span className="text-[8px] text-[#3399FF]/50 font-bold">START/STOP ONLY</span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickLogin("viewer", "viewer2026")}
            disabled={loading}
            className="w-full bg-zinc-950/20 border border-zinc-700 hover:bg-zinc-800 text-zinc-400 py-2.5 px-4 font-mono text-[10px] uppercase font-black transition flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <User className="h-3 w-3 text-zinc-400" />
              COMPLIANCE VIEWER (审计只读)
            </span>
            <span className="text-[8px] text-zinc-550 font-bold">READ ONLY</span>
          </button>
        </div>

        <div className="mt-8 text-center border-t border-[#1C1C1E] pt-4 flex items-center justify-center gap-1.5 text-[9px] font-mono text-[#555557] font-semibold uppercase">
          <HelpCircle className="h-3.5 w-3.5 text-[#555557]" />
          Aegis dual-auth safeguards P0-3/4 requirements
        </div>
      </div>
    </div>
  );
}
