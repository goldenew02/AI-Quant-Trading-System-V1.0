import React, { useState } from "react";
import { ShieldAlert, Key, HelpCircle, RefreshCw, User, Lock, Terminal, Fingerprint, Copy, Check } from "lucide-react";
import { apiFetch } from "../lib/api";

interface AegisLoginProps {
  onLoginSuccess: (role: 'admin' | 'operator' | 'viewer', username: string) => void;
}

export default function AegisLogin({ onLoginSuccess }: AegisLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Dynamic TOTP enrollment states
  const [mfaSetupMode, setMfaSetupMode] = useState(false);
  const [tempSecret, setTempSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [tempRole, setTempRole] = useState<'admin' | 'operator' | 'viewer' | null>(null);
  const [tempUsername, setTempUsername] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Split login states (for already-enrolled users)
  const [loginMfaMode, setLoginMfaMode] = useState(false);
  const [preauthId, setPreauthId] = useState<string | null>(null);
  const [loginTotpCode, setLoginTotpCode] = useState("");

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (!username.trim() || !password.trim()) {
      setError("Please fill in both telemetry access credentials.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password: password }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        
        if (data.requiresTotp) {
          // 2FA login phase 1 success: store preauthId and transition to stage 2 (P0-1)
          setPreauthId(data.preauthId);
          setLoginMfaMode(true);
        } else if (data.mustEnrollTotp) {
          // Store temp credentials and trigger dynamic TOTP setup workflow (P0-1.5)
          setTempRole(data.role);
          setTempUsername(data.username);
          
          // Verify session is successfully established before proceeding to setup (Audit P0-4)
          const meRes = await apiFetch("/api/auth/me");
          if (!meRes.ok) {
            setError(`Password accepted, but session cookie was not established (HTTP ${meRes.status}). Check COOKIE_SECURE / COOKIE_SAMESITE / HTTPS settings.`);
            setLoading(false);
            return;
          }

          const setupRes = await apiFetch("/api/auth/totp/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          
          if (setupRes.ok) {
            const setupData = await setupRes.json();
            setTempSecret(setupData.tempSecret);
            setMfaSetupMode(true);
          } else {
            let detail = `HTTP ${setupRes.status}`;
            try {
              const ct = setupRes.headers.get("content-type") || "";
              if (ct.includes("application/json")) {
                const errData = await setupRes.json();
                detail = errData.error || detail;
              } else {
                detail = await setupRes.text() || detail;
              }
            } catch {}
            setError(`Authentication succeeded but failed to initialize secure TOTP setup channel: ${detail}`);
          }
        } else {
          // Fallback (e.g. if TOTP is bypassed or disabled)
          onLoginSuccess(data.role, data.username);
        }
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

  const handleLoginTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (loginTotpCode.trim().length !== 6) {
      setError("Dynamic MFA code must be exactly 6 digits.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/login/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preauthId, code: loginTotpCode.trim() })
      });

      if (res.ok) {
        const data = await res.json();
        onLoginSuccess(data.role, data.username);
      } else {
        const data = await res.json();
        setError(data.error || "Dynamic MFA code verification failed. Access denied.");
      }
    } catch (err) {
      console.error(err);
      setError("MFA authentication channel interrupted. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (totpCode.trim().length !== 6) {
      setError("Dynamic MFA code must be exactly 6 digits.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode.trim() })
      });

      if (res.ok) {
        // Enforce re-login after setup to comply with complete session rotation (P0-1.4)
        setSuccessMsg("Google 2FA bound successfully! For security, your session has been rotated. Please enter your credentials and dynamic code again.");
        setMfaSetupMode(false);
        setUsername("");
        setPassword("");
        setTotpCode("");
      } else {
        const data = await res.json();
        setError(data.error || "Dynamic MFA code verification failed. Setup not complete.");
      }
    } catch (err) {
      console.error(err);
      setError("MFA confirmation channel interrupted. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = () => {
    if (tempSecret) {
      navigator.clipboard.writeText(tempSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            {mfaSetupMode ? "MFA ACTIVATION SHIELD" : "AEGIS SECURITY PROTOCOL"}
          </h2>
          <p className="text-[10px] text-[#666666] font-mono tracking-widest uppercase font-black mt-1">
            {mfaSetupMode ? "Secure Authentication Onboarding Guide" : "ARM Execution Core Authorization Shield v2.4"}
          </p>
        </div>

        {/* System Success Message */}
        {successMsg && (
          <div className="bg-[#00FF66]/10 border border-[#00FF66] text-[#00FF66] p-3 text-xs font-mono uppercase rounded-none mb-6">
            <strong className="block text-[10px] font-black tracking-wider mb-0.5">🟢 TRANSACTION SECURE:</strong>
            {successMsg}
          </div>
        )}

        {/* System Error Message */}
        {error && (
          <div className="bg-[#FF3333]/15 border border-[#FF3333] text-[#FF3333] p-3 text-xs font-mono uppercase rounded-none mb-6">
            <strong className="block text-[10px] font-black tracking-wider mb-0.5">⚠️ SECURE CRITICAL ERROR:</strong>
            {error}
          </div>
        )}

        {loginMfaMode ? (
          /* Dynamic Login MFA/TOTP Form (P0-1 Phase 2 Challenge) */
          <form onSubmit={handleLoginTotpSubmit} className="space-y-5">
            <div className="bg-[#1C1C1E]/50 border border-[#2A2A2C] p-4 text-xs space-y-2 font-sans leading-relaxed text-zinc-300">
              <div className="flex items-center gap-2 text-[#00FF66] font-bold font-mono text-[10px]">
                <Fingerprint className="h-4 w-4 animate-pulse text-[#00FF66]" />
                <span>DYNAMIC MULTI-FACTOR CHALLENGE</span>
              </div>
              <p>
                Dynamic Google Authenticator code is required for operator account <strong>{username}</strong>. Please consult your Google Authenticator device.
              </p>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1.5">
                Dynamic 6-Digit Authenticator Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={loginTotpCode}
                onChange={(e) => setLoginTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                disabled={loading}
                autoFocus
                className="bg-[#060608] border border-[#2A2A2C] text-white placeholder-[#444446] tracking-[0.8em] text-center font-bold font-mono text-lg py-3.5 w-full focus:outline-none focus:border-[#00FF66]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setLoginMfaMode(false);
                  setLoginTotpCode("");
                }}
                className="w-1/3 border border-[#2A2A2C] text-[#666666] font-bold uppercase text-xs py-4 hover:bg-zinc-900 transition font-mono cursor-pointer"
              >
                BACK
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-2/3 bg-[#00FF66] text-black font-black uppercase text-xs tracking-wider py-4 hover:bg-[#00CC55] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-mono"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-black" />
                    AUTHORIZING ACCESS...
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-black" />
                    CONFIRM & ENTER
                  </>
                )}
              </button>
            </div>
          </form>
        ) : !mfaSetupMode ? (
          /* Credentials Form */
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
              className="w-full bg-[#00FF66] text-black font-black uppercase text-xs tracking-wider py-4 hover:bg-[#00CC55] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2 font-mono"
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
        ) : (
          /* Multi-Factor Authentication Setup Flow (P0-1.5 Compliance) */
          <form onSubmit={handleMfaConfirmSubmit} className="space-y-5">
            <div className="bg-[#1C1C1E]/50 border border-[#2A2A2C] p-4 text-xs space-y-3 font-sans leading-relaxed text-zinc-300">
              <div className="flex items-center gap-2 text-amber-500 font-bold font-mono text-[10px]">
                <Fingerprint className="h-4 w-4 animate-pulse text-amber-500" />
                <span>DYNAMIC TOTP MFA BIND REQUIRED</span>
              </div>
              <p>
                To safeguard client assets and prevent unauthorized control commands, your account must enroll a dynamic Multi-Factor Authentication token.
              </p>
              <div className="space-y-1 bg-[#060608] p-3 border border-zinc-800 font-mono text-[10px]">
                <div className="text-[#666666] uppercase font-black text-[9px] mb-1.5">Google Authenticator Key:</div>
                <div className="flex items-center justify-between gap-2 text-white font-bold select-all tracking-wider text-xs p-1.5 bg-[#141416] border border-zinc-850">
                  <span>{tempSecret}</span>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    className="p-1 hover:text-[#00FF66] text-[#666666] transition cursor-pointer"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-[#00FF66]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-zinc-400">
                <li>Open Google Authenticator on your mobile device.</li>
                <li>Add a new account and choose <strong className="text-zinc-300 font-medium">"Enter a setup key"</strong>.</li>
                <li>Enter the setup key above under standard Time-Based (TOTP) setting.</li>
                <li>Input the generated 6-digit dynamic code below to complete authorization.</li>
              </ol>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1.5">
                Dynamic 6-Digit Authenticator Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                disabled={loading}
                className="bg-[#060608] border border-[#2A2A2C] text-white placeholder-[#444446] tracking-[0.8em] text-center font-bold font-mono text-lg py-3.5 w-full focus:outline-none focus:border-[#00FF66]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMfaSetupMode(false)}
                className="w-1/3 border border-[#2A2A2C] text-[#666666] font-bold uppercase text-xs py-4 hover:bg-zinc-900 transition font-mono cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-2/3 bg-[#00FF66] text-black font-black uppercase text-xs tracking-wider py-4 hover:bg-[#00CC55] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 font-mono"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-black" />
                    CONFIRMING BIND...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 text-black" />
                    ACTIVATE & ENTER
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Security Info Panel for Compliance Auditing */}
        <div className="bg-[#1C1C1E]/50 border border-zinc-800 p-4 mt-6">
          <div className="flex items-center gap-2 mb-2 text-[#00FF66]">
            <Terminal className="h-4 w-4" />
            <h3 className="text-[10px] font-mono uppercase tracking-wider font-black">
              SECURE BOOTSTRAP TELEMETRY INFO
            </h3>
          </div>
          <p className="text-[10px] text-zinc-400 leading-relaxed font-sans mb-3">
            In compliance with Audit Point P0-2, insecure quick login buttons and default hardcoded credentials have been physically purged from the codebase.
          </p>
          <div className="space-y-2 font-mono text-[9px] text-zinc-450">
            <div className="p-3 bg-[#060608] border border-zinc-850 rounded-none space-y-1">
              <div className="text-zinc-300 font-bold uppercase text-[10px] tracking-wide border-b border-zinc-800 pb-1 mb-1 flex justify-between">
                <span>Secure Bootstrap Status</span>
                <span className="text-[#00FF66]">COMPLIANT</span>
              </div>
              <div>- Database: <span className="text-zinc-300">Active (AES-256-GCM Encrypted Secrets)</span></div>
              <div>- Signatures: <span className="text-zinc-300">PBKDF2-SHA512 (310,000 iterations)</span></div>
              <div>- MFA Policy: <span className="text-zinc-300">Dynamic Google Authenticator RFC6238</span></div>
              <div className="pt-2 text-zinc-500 italic leading-normal font-sans text-left">
                To log in, please use the secure credentials configured via your environment setup (e.g. BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD).
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center border-t border-[#1C1C1E] pt-4 flex items-center justify-center gap-1.5 text-[9px] font-mono text-[#555557] font-semibold uppercase">
          <HelpCircle className="h-3.5 w-3.5 text-[#555557]" />
          Aegis dual-auth safeguards P0-3/4 requirements
        </div>
      </div>
    </div>
  );
}
