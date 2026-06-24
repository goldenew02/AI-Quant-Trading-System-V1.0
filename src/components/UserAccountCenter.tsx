import React, { useState, useEffect } from "react";
import { 
  User, 
  Key, 
  UserPlus, 
  ShieldAlert, 
  ShieldCheck, 
  RefreshCw, 
  CheckCircle2, 
  Trash2, 
  Settings, 
  QrCode,
  Terminal,
  UserCheck
} from "lucide-react";

interface UserAccountCenterProps {
  secureFetch: (url: string, options?: RequestInit) => Promise<Response>;
  currentRole: 'admin' | 'operator' | 'viewer';
  currentUsername: string;
}

interface UserProfile {
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  isActive: boolean;
  hasTotpSecret: boolean;
}

export default function UserAccountCenter({ secureFetch, currentRole, currentUsername }: UserAccountCenterProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // New User Form States
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<'admin' | 'operator' | 'viewer'>("operator");
  const [creatingUser, setCreatingUser] = useState(false);

  // TOTP Configuration States
  const [totpSetupSecret, setTotpSetupSecret] = useState<string | null>(null);
  const [totpVerificationCode, setTotpVerificationCode] = useState("");
  const [confirmingTotp, setConfirmingTotp] = useState(false);
  const [totpSetupSuccess, setTotpSetupSuccess] = useState(false);

  const fetchUsers = async () => {
    if (currentRole !== "admin") return;
    try {
      setLoading(true);
      const res = await secureFetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [currentRole]);

  // Handle user creation
  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      setMessage({ text: "Please enter both username and password.", isError: true });
      return;
    }

    try {
      setCreatingUser(true);
      setMessage(null);
      const res = await secureFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword.trim(),
          role: newRole
        })
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ text: `✓ User account '${data.user.username}' provisioned successfully! TOTP secret setup is required on first login.`, isError: false });
        setNewUsername("");
        setNewPassword("");
        fetchUsers();
      } else {
        setMessage({ text: `Error: ${data.error || "Failed to create user."}`, isError: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error connecting to server.", isError: true });
    } finally {
      setCreatingUser(false);
    }
  };

  // Setup TOTP Wizard
  const handleStartTotpSetup = async () => {
    try {
      setMessage(null);
      setTotpSetupSuccess(false);
      setTotpSetupSecret(null);
      setTotpVerificationCode("");

      const res = await secureFetch("/api/auth/totp/setup", {
        method: "POST"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTotpSetupSecret(data.secret);
      } else {
        setMessage({ text: `Failed to initiate TOTP setup: ${data.error || "Unknown error."}`, isError: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Failed to connect to authentication backend.", isError: true });
    }
  };

  // Confirm TOTP Code
  const handleConfirmTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpVerificationCode.trim()) return;

    try {
      setConfirmingTotp(true);
      setMessage(null);

      const res = await secureFetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpVerificationCode.trim() })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTotpSetupSuccess(true);
        setTotpSetupSecret(null);
        setTotpVerificationCode("");
        setMessage({ text: "✓ Multi-Factor Authentication successfully enrolled! Dynamic TOTP protection is active on your profile.", isError: false });
        fetchUsers();
      } else {
        setMessage({ text: `Validation failed: ${data.error || "Incorrect or expired code."}`, isError: true });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error validating verification code.", isError: true });
    } finally {
      setConfirmingTotp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview and Profile Card */}
      <div className="bg-[#141416] border border-[#2A2A2C] p-6 rounded-none">
        <div className="flex gap-3 items-center mb-6 border-b border-[#2A2A2C] pb-4">
          <Settings className="h-6 w-6 text-[#00FF66]" />
          <div>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
              Dual-Auth Keyring Management
            </span>
            <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display">
              User Credentials & Access Center
            </h2>
            <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
              Configure personal MFA authenticators and review session security profiles.
            </p>
          </div>
        </div>

        {message && (
          <div className={`p-4 rounded-none text-xs font-mono uppercase mb-6 border ${
            message.isError 
              ? "bg-[#FF3333]/10 border-[#FF3333] text-[#FF3333]" 
              : "bg-[#00FF66]/10 border-[#00FF66] text-[#00FF66]"
          }`}>
            <strong className="block text-[10px] font-black tracking-wider mb-0.5">
              {message.isError ? "⚠️ TELEMETRY WARN:" : "✓ SECURITY MESSAGE:"}
            </strong>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Active Profile Info */}
          <div className="bg-[#0A0A0B] p-5 border border-[#2A2A2C] flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-black uppercase text-white font-mono tracking-wider border-b border-[#2D2D30] pb-2 mb-4 flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#00FF66]" />
                CURRENTLY LOGGED PROFILE
              </h3>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between border-b border-[#2A2A2C]/40 pb-2">
                  <span className="text-[#666666] uppercase">Username:</span>
                  <span className="text-white font-bold">{currentUsername}</span>
                </div>
                <div className="flex justify-between border-b border-[#2A2A2C]/40 pb-2">
                  <span className="text-[#666666] uppercase">Access Clearance Level:</span>
                  <span className={`font-black uppercase ${
                    currentRole === 'admin' ? "text-[#FF3333]" : currentRole === 'operator' ? "text-[#3399FF]" : "text-zinc-400"
                  }`}>{currentRole}</span>
                </div>
                <div className="flex justify-between border-b border-[#2A2A2C]/40 pb-2">
                  <span className="text-[#666666] uppercase">Security Engine Status:</span>
                  <span className="text-emerald-400 font-bold uppercase">ACTIVE SESS (COOKIE LOCKED)</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[#2D2D30]">
              <h4 className="text-[10px] font-bold text-[#666666] uppercase tracking-wider mb-2">Configure Multi-Factor Authentication</h4>
              {!totpSetupSecret ? (
                <button
                  onClick={handleStartTotpSetup}
                  className="bg-[#00FF66] hover:bg-[#00CC55] text-black font-black uppercase text-xs px-4 py-2.5 rounded-none tracking-wider transition cursor-pointer flex items-center gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  SETUP GOOGLE AUTHENTICATOR (MFA)
                </button>
              ) : (
                <div className="space-y-4 bg-[#141416] p-4 border border-[#2A2A2C] mt-2">
                  <div className="flex items-center gap-2 text-[#00FF66]">
                    <QrCode className="h-5 w-5 animate-pulse" />
                    <span className="text-[10px] font-mono uppercase tracking-wider font-black">SCAN GOOGLE AUTHENTICATOR QR/SECRET</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-normal font-sans">
                    Open your standard mobile Google Authenticator or Microsoft Authenticator application, choose "Enter a setup key", type a name like <span className="text-white">"AegisQuant"</span> and enter this secret key:
                  </p>
                  <div className="p-3 bg-black border border-zinc-800 text-center font-mono font-black text-xs text-[#00FF66] tracking-widest select-all">
                    {totpSetupSecret}
                  </div>
                  <form onSubmit={handleConfirmTotpSubmit} className="space-y-2 pt-2 border-t border-zinc-800">
                    <label className="block text-[9px] font-mono text-[#666666] uppercase font-black">
                      6-Digit Dynamic Verification Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={totpVerificationCode}
                        onChange={(e) => setTotpVerificationCode(e.target.value)}
                        placeholder="e.g. 123456"
                        className="bg-black border border-zinc-800 text-white placeholder-zinc-700 text-xs py-2 px-3 focus:outline-none focus:border-[#00FF66] font-mono tracking-widest"
                      />
                      <button
                        type="submit"
                        disabled={confirmingTotp || !totpVerificationCode}
                        className="bg-[#00FF66] text-black hover:bg-[#00CC55] font-black uppercase text-xs px-4 py-2 rounded-none transition flex items-center gap-1 cursor-pointer disabled:opacity-40"
                      >
                        {confirmingTotp ? <RefreshCw className="h-3 w-3 animate-spin text-black" /> : <ShieldCheck className="h-3.5 w-3.5 text-black" />}
                        CONFIRM
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>

          {/* Secure Administrative User Creation (Visible to admin only) */}
          <div className="bg-[#0A0A0B] p-5 border border-[#2A2A2C] flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-black uppercase text-white font-mono tracking-wider border-b border-[#2D2D30] pb-2 mb-4 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#00FF66]" />
                PROVISION NEW ACCESS KEY (Admin Only)
              </h3>
              {currentRole === 'admin' ? (
                <form onSubmit={handleCreateUserSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1">
                      New Username
                    </label>
                    <input
                      type="text"
                      placeholder="Enter username..."
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="bg-black border border-zinc-800 text-white placeholder-zinc-750 text-xs py-2 px-3 w-full focus:outline-none focus:border-[#00FF66] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      placeholder="Enter secure password sequence..."
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="bg-black border border-zinc-800 text-white placeholder-zinc-750 text-xs py-2 px-3 w-full focus:outline-none focus:border-[#00FF66] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-[#666666] uppercase font-black tracking-wider mb-1">
                      Clearance Permission Level
                    </label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as any)}
                      className="bg-black border border-zinc-800 text-white text-xs py-2 px-3 w-full focus:outline-none focus:border-[#00FF66] font-mono uppercase"
                    >
                      <option value="operator">Operator (操作员) - Start/Stop & Conf</option>
                      <option value="viewer">Viewer (审计审计) - Read-Only Auditing</option>
                      <option value="admin">Admin (管理员) - Global Full Control</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="w-full bg-[#00FF66] text-black font-black uppercase text-xs py-3 hover:bg-[#00CC55] transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 mt-4"
                  >
                    {creatingUser ? <RefreshCw className="h-4 w-4 animate-spin text-black" /> : <UserPlus className="h-4 w-4 text-black" />}
                    PROVISION USER TERMINAL
                  </button>
                </form>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3 bg-[#141416]/50 border border-zinc-850 p-4">
                  <ShieldAlert className="h-10 w-10 text-[#FF3333]/70" />
                  <p className="text-[11px] text-zinc-500 font-mono uppercase leading-relaxed max-w-xs">
                    Access Denied. User creation and credential auditing require Level 3 Administrator Clearance.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Database Registered Users Inventory (Admin Only) */}
      {currentRole === "admin" && (
        <div className="bg-[#141416] border border-[#2A2A2C] p-6 rounded-none">
          <h3 className="text-xs font-black uppercase text-white font-mono tracking-wider border-b border-[#2D2D30] pb-3 mb-4 flex items-center gap-2">
            <Terminal className="h-4.5 w-4.5 text-[#00FF66]" />
            AEGIS DATABASE USER SECURITY LEDGER
          </h3>
          {loading ? (
            <div className="flex justify-center items-center py-6">
              <RefreshCw className="h-5 w-5 animate-spin text-[#00FF66]" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-[#2D2D30] text-[#666666] uppercase text-[9px] tracking-widest font-black">
                    <th className="py-2.5 px-3">REGISTERED USER</th>
                    <th className="py-2.5 px-3">ROLE CLEARANCE</th>
                    <th className="py-2.5 px-3">MFA (TOTP) STATUS</th>
                    <th className="py-2.5 px-3">CORE STATE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2A2C]/40 text-zinc-300">
                  {users.map((u) => (
                    <tr key={u.username} className="hover:bg-zinc-900/30">
                      <td className="py-3 px-3 font-bold text-white flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-zinc-500" />
                        {u.username}
                        {u.username === currentUsername && <span className="text-[8px] bg-emerald-900/30 text-[#00FF66] border border-[#00FF66] px-1.5 py-0.2 uppercase rounded-none ml-1">You</span>}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-[10px] px-2 py-0.5 font-bold rounded-none uppercase ${
                          u.role === 'admin' ? "bg-red-950/20 text-[#FF3333] border border-[#FF3333]" : u.role === 'operator' ? "bg-blue-950/20 text-[#3399FF] border border-[#3399FF]" : "bg-zinc-900 text-zinc-400 border border-zinc-800"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        {u.hasTotpSecret ? (
                          <span className="text-[#00FF66] font-bold flex items-center gap-1 text-[10px] uppercase">
                            <ShieldCheck className="h-4 w-4 text-[#00FF66]" />
                            ENROLLED
                          </span>
                        ) : (
                          <span className="text-amber-500 font-bold flex items-center gap-1 text-[10px] uppercase">
                            <ShieldAlert className="h-4 w-4 text-amber-500 animate-pulse" />
                            UNPROTECTED (NOT SETUP)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-emerald-400 font-bold uppercase text-[10px]">Active</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
