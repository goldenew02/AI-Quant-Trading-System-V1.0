import React, { useState, useEffect } from "react";
import { Shield, Trash2, Key, ToggleLeft, ToggleRight, Plus, RefreshCw, Layers, ListTodo, History, CheckCircle, HelpCircle, AlertCircle } from "lucide-react";
import { BrokerAccount, Order, Fill } from "../types";
import { apiFetch } from "../lib/api";

interface BrokerAccountManagerProps {
  role: 'admin' | 'operator' | 'viewer' | null;
  username: string | null;
}

export default function BrokerAccountManager({ role, username }: BrokerAccountManagerProps) {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [resolveMfaModal, setResolveMfaModal] = useState<{
    isOpen: boolean;
    clientOrderId: string;
    resolutionAction: string;
    brokerOrderId?: string;
    tokenInput: string;
  }>({ isOpen: false, clientOrderId: "", resolutionAction: "", tokenInput: "" });
  const [fills, setFills] = useState<Fill[]>([]);
  
  const [broker, setBroker] = useState<string>("Binance");
  const [accountAlias, setAccountAlias] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [passphrase, setPassphrase] = useState<string>("");
  const [isSandbox, setIsSandbox] = useState<boolean>(true);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [activeSubTab, setActiveSubTab] = useState<"credentials" | "orders" | "fills">("credentials");

  const fetchData = async () => {
    try {
      setLoading(true);
      const accountsRes = await apiFetch("/api/broker-accounts");
      if (accountsRes.ok) {
        setAccounts(await accountsRes.json());
      }
      const ordersRes = await apiFetch("/api/orders");
      if (ordersRes.ok) {
        setOrders(await ordersRes.json());
      }
      const fillsRes = await apiFetch("/api/fills");
      if (fillsRes.ok) {
        setFills(await fillsRes.json());
      }
    } catch (err: any) {
      console.error("Error loading broker data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!accountAlias || !apiKey || !secret) {
      setError("Please fill out all required fields.");
      return;
    }

    try {
      setLoading(true);
      const res = await apiFetch("/api/broker-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broker,
          accountAlias,
          apiKey,
          secret,
          passphrase,
          isSandbox
        })
      });

      if (res.ok) {
        setSuccess(`Successfully registered ${broker} credentials.`);
        setAccountAlias("");
        setApiKey("");
        setSecret("");
        setPassphrase("");
        fetchData();
      } else {
        const errData = await res.json();
        setError(errData.error || "Failed to register credentials.");
      }
    } catch (err: any) {
      setError(err.message || "Network exception.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (role !== "admin") {
      setError("Only administrators can delete configured credentials.");
      return;
    }
    if (!confirm("Are you sure you want to remove these encrypted broker credentials?")) {
      return;
    }

    try {
      setLoading(true);
      const res = await apiFetch(`/api/broker-accounts/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setSuccess("Credentials successfully deleted.");
        fetchData();
      } else {
        const errData = await res.json();
        setError(errData.error || "Failed to delete account.");
      }
    } catch (err: any) {
      setError(err.message || "Network exception.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0e0e11] border border-[#232329] p-6 rounded-none space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#232329] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2 font-display uppercase tracking-wider">
            <Shield className="h-5 w-5 text-[#00FF66]" />
            BROKER CONNECTIVITY HUB (券商直连管理)
          </h2>
          <p className="text-xs text-[#8c8c9a] mt-1">
            Configure encrypted API keys for live transactions. Aegis secures all credentials with hardware-isolated AES-256-GCM encryption.
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="self-start sm:self-center bg-[#15151b] border border-[#2a2a35] hover:bg-[#1f1f2a] text-xs font-semibold px-4 py-2 flex items-center gap-2 text-white transition disabled:opacity-50 uppercase tracking-widest font-mono"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          SYNC HUB
        </button>
      </div>

      {error && (
        <div className="bg-[#1f1315] border border-[#bd3a3a] text-[#ff8c8c] text-xs p-3 flex items-center gap-2 font-mono">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-[#101c14] border border-[#2e7d32] text-[#81c784] text-xs p-3 flex items-center gap-2 font-mono">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex border-b border-[#232329]">
        <button
          onClick={() => setActiveSubTab("credentials")}
          className={`py-2.5 px-4 text-xs font-bold uppercase tracking-wider transition font-mono border-b-2 cursor-pointer flex items-center gap-2 ${
            activeSubTab === "credentials"
              ? "border-[#00FF66] text-white bg-[#141419]"
              : "border-transparent text-[#8c8c9a] hover:text-white"
          }`}
        >
          <Key className="h-3.5 w-3.5 text-[#00FF66]" />
          API Credential Vault ({accounts.length})
        </button>
        <button
          onClick={() => setActiveSubTab("orders")}
          className={`py-2.5 px-4 text-xs font-bold uppercase tracking-wider transition font-mono border-b-2 cursor-pointer flex items-center gap-2 ${
            activeSubTab === "orders"
              ? "border-[#00FF66] text-white bg-[#141419]"
              : "border-transparent text-[#8c8c9a] hover:text-white"
          }`}
        >
          <ListTodo className="h-3.5 w-3.5 text-[#00FF66]" />
          Order State Machine ({orders.length})
        </button>
        <button
          onClick={() => setActiveSubTab("fills")}
          className={`py-2.5 px-4 text-xs font-bold uppercase tracking-wider transition font-mono border-b-2 cursor-pointer flex items-center gap-2 ${
            activeSubTab === "fills"
              ? "border-[#00FF66] text-white bg-[#141419]"
              : "border-transparent text-[#8c8c9a] hover:text-white"
          }`}
        >
          <History className="h-3.5 w-3.5 text-[#00FF66]" />
          Execution Fills Ledger ({fills.length})
        </button>
      </div>

      {activeSubTab === "credentials" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Add credentials form */}
          <form onSubmit={handleAddAccount} className="bg-[#141419] border border-[#232329] p-5 space-y-4 lg:col-span-1">
            <h3 className="text-xs font-bold text-[#00FF66] uppercase tracking-widest font-mono flex items-center gap-1.5 border-b border-[#232329] pb-2">
              <Plus className="h-4 w-4" />
              REGISTER NEW ENDPOINT
            </h3>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold block">
                Broker / Exchange Target
              </label>
              <select
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
                className="w-full bg-[#0d0d10] border border-[#2a2a34] text-xs text-white p-2.5 rounded-none focus:outline-none focus:border-[#00FF66] font-mono"
              >
                <option value="Binance">Binance Spot / Futures</option>
                <option value="OKX">OKX Exchange</option>
                <option value="Longbridge">Longbridge OpenAPI</option>
                <option value="Tiger">Tiger Brokers (openapi)</option>
                <option value="IB">Interactive Brokers Gateway</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold block">
                Account Alias (Unique ID)
              </label>
              <input
                type="text"
                placeholder="e.g. Binance_Live_One"
                value={accountAlias}
                onChange={(e) => setAccountAlias(e.target.value)}
                className="w-full bg-[#0d0d10] border border-[#2a2a34] text-xs text-white p-2.5 rounded-none focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold block">
                API Key / Tiger ID / Gateway Port
              </label>
              <input
                type="password"
                placeholder="Paste API Key or ID"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-[#0d0d10] border border-[#2a2a34] text-xs text-white p-2.5 rounded-none focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold block">
                API Secret Key / RSA Private PEM
              </label>
              <input
                type="password"
                placeholder="Paste API Secret or PEM content"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full bg-[#0d0d10] border border-[#2a2a34] text-xs text-white p-2.5 rounded-none focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold block">
                Passphrase (OKX / IB Account ID)
              </label>
              <input
                type="password"
                placeholder="Leave blank if not required"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full bg-[#0d0d10] border border-[#2a2a34] text-xs text-white p-2.5 rounded-none focus:outline-none focus:border-[#00FF66] font-mono"
              />
            </div>

            <div className="flex items-center justify-between py-2 border-t border-b border-[#232329]">
              <span className="text-[10px] text-[#8c8c9a] uppercase font-mono tracking-wider font-bold">
                Run Sandbox Mode (Testnet)
              </span>
              <button
                type="button"
                onClick={() => setIsSandbox(!isSandbox)}
                className="text-white hover:text-[#00FF66] focus:outline-none"
              >
                {isSandbox ? (
                  <ToggleRight className="h-6 w-6 text-[#00FF66]" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-[#666]" />
                )}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || role === "viewer"}
              className="w-full bg-[#00FF66] hover:bg-[#00dd55] text-black font-black text-xs py-3 px-4 rounded-none transition uppercase tracking-widest font-mono disabled:opacity-50"
            >
              SAVE SECURE ENDPOINT
            </button>
          </form>

          {/* Accounts grid */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-xs font-bold text-[#8c8c9a] uppercase tracking-widest font-mono border-b border-[#232329] pb-2">
              ACTIVE ENCRYPTED ENDPOINTS
            </h3>

            {accounts.length === 0 ? (
              <div className="bg-[#141419] border border-[#232329] p-8 text-center text-xs text-[#6e6e7a] font-mono">
                No real broker accounts registered. System is operating strictly in Isolated Paper Trading simulation mode.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {accounts.map((acc) => (
                  <div key={acc.id} className="bg-[#141419] border border-[#232329] p-4 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white uppercase font-display tracking-wide">
                          {acc.broker}
                        </span>
                        <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 ${
                          acc.isSandbox 
                            ? "bg-[#2b1f1d] text-[#e57373] border border-[#e57373]/20" 
                            : "bg-[#1b2b1d] text-[#81c784] border border-[#81c784]/20"
                        }`}>
                          {acc.isSandbox ? "SANDBOX" : "PROD LIVE"}
                        </span>
                      </div>
                      <h4 className="text-xs font-bold text-[#00FF66] font-mono">
                        Alias: {acc.accountAlias}
                      </h4>
                      <p className="text-[10px] text-[#6e6e7a] font-mono">
                        ID: {acc.id}
                      </p>
                      <p className="text-[10px] text-[#6e6e7a] font-mono">
                        Added: {new Date(acc.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-[#232329] pt-2">
                      <span className="text-[10px] text-[#8c8c9a] font-mono uppercase">
                        Permissions: {acc.permissions}
                      </span>
                      {role === "admin" && (
                        <button
                          onClick={() => handleDeleteAccount(acc.id)}
                          className="text-[#ff5555] hover:text-[#ff3333] p-1 border border-[#ff5555]/10 hover:bg-[#ff5555]/5 transition"
                          title="Delete endpoint"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "orders" && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#8c8c9a] uppercase tracking-widest font-mono border-b border-[#232329] pb-2">
            ORDER TRANSACTION TRANSITIONS
          </h3>

          {orders.length === 0 ? (
            <div className="bg-[#141419] border border-[#232329] p-8 text-center text-xs text-[#6e6e7a] font-mono">
              No orders registered on ledger.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#232329] text-[#8c8c9a]">
                    <th className="p-3 uppercase">Timestamp</th>
                    <th className="p-3 uppercase">Broker / Account</th>
                    <th className="p-3 uppercase">Client ID</th>
                    <th className="p-3 uppercase">Symbol</th>
                    <th className="p-3 uppercase">Action</th>
                    <th className="p-3 uppercase text-right">Price / Qty</th>
                    <th className="p-3 uppercase text-center">State Machine Ack</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((ord) => (
                    <tr key={ord.id} className="border-b border-[#1b1b22] hover:bg-[#141419] transition">
                      <td className="p-3 text-[#8c8c9a] whitespace-nowrap">
                        {new Date(ord.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-bold text-white block">{ord.broker}</span>
                        <span className="text-[10px] text-[#6e6e7a] block">{ord.brokerAccountId}</span>
                      </td>
                      <td className="p-3 font-bold text-[#00FF66] whitespace-nowrap">
                        {ord.clientOrderId}
                        {ord.brokerOrderId && (
                          <span className="text-[9px] text-[#6e6e7a] block">BrokerID: {ord.brokerOrderId}</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap text-white font-black">
                        {ord.symbol}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-[10px] font-bold ${
                          ord.side === "BUY" ? "bg-[#1b2b1d] text-[#00FF66]" : "bg-[#2b1f1d] text-[#ff3333]"
                        }`}>
                          {ord.side}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="text-white font-bold">${ord.price}</div>
                        <div className="text-[10px] text-[#8c8c9a]">{ord.quantity} units</div>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2 py-0.5 font-bold uppercase text-[10px] ${
                            ord.status === "FILLED" 
                              ? "bg-[#1b2b1d] text-[#81c784] border border-[#81c784]/20"
                              : ord.status === "PENDING"
                              ? "bg-[#2b251d] text-[#ffb74d] border border-[#ffb74d]/20"
                              : ord.status === "REJECTED"
                              ? "bg-[#2b1d1d] text-[#ff5555] border border-[#ff5555]/20"
                              : "bg-[#1e1e24] text-[#8c8c9a]"
                          }`}>
                            {ord.status}
                          </span>
                          {ord.lastError && (
                            <span className="text-[9px] text-[#ff8c8c] max-w-xs block text-center truncate">
                              Err: {ord.lastError}
                            </span>
                          )}
                          {ord.manualReviewRequired && (
                            <div className="mt-2 flex flex-wrap gap-2 justify-center border-t border-[#1b1b22] pt-2">
                              <div className="text-[#ff5555] font-bold text-[10px] w-full text-center">MANUAL REVIEW REQUIRED</div>
                              {ord.lastBrokerStatus === "CLIENT_ORDER_LOOKUP_UNSUPPORTED" && (
                                <div className="text-[#ffb74d] text-[9px] w-full text-center">Broker lookup unsupported.</div>
                              )}
                              <button 
                                onClick={() => setResolveMfaModal({ isOpen: true, clientOrderId: ord.clientOrderId, resolutionAction: "attachBrokerOrderId", brokerOrderId: "", tokenInput: "" })}
                                className="px-2 py-1 bg-[#141419] border border-[#232329] text-[9px] text-[#00FF66] hover:bg-[#1b2b1d] transition"
                              >
                                Attach Broker ID
                              </button>
                              <button 
                                onClick={() => setResolveMfaModal({ isOpen: true, clientOrderId: ord.clientOrderId, resolutionAction: "markCanceled", tokenInput: "" })}
                                className="px-2 py-1 bg-[#141419] border border-[#232329] text-[9px] text-white hover:bg-[#2b1f1d] transition"
                              >
                                Mark Canceled
                              </button>
                              <button 
                                onClick={() => setResolveMfaModal({ isOpen: true, clientOrderId: ord.clientOrderId, resolutionAction: "markRejected", tokenInput: "" })}
                                className="px-2 py-1 bg-[#141419] border border-[#232329] text-[9px] text-[#ff5555] hover:bg-[#2b1f1d] transition"
                              >
                                Mark Rejected
                              </button>
                              <button 
                                onClick={() => setResolveMfaModal({ isOpen: true, clientOrderId: ord.clientOrderId, resolutionAction: "requestCancel", tokenInput: "" })}
                                className="px-2 py-1 bg-[#141419] border border-[#232329] text-[9px] text-[#ffb74d] hover:bg-[#2b251d] transition"
                              >
                                Request Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeSubTab === "fills" && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-[#8c8c9a] uppercase tracking-widest font-mono border-b border-[#232329] pb-2">
            CRISP FILLED EXECUTION ARCHIVE
          </h3>

          {fills.length === 0 ? (
            <div className="bg-[#141419] border border-[#232329] p-8 text-center text-xs text-[#6e6e7a] font-mono">
              No fills recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#232329] text-[#8c8c9a]">
                    <th className="p-3 uppercase">Timestamp</th>
                    <th className="p-3 uppercase">Order Reference</th>
                    <th className="p-3 uppercase">Broker Fill Reference</th>
                    <th className="p-3 uppercase text-right">Match Price</th>
                    <th className="p-3 uppercase text-right">Quantity Fill</th>
                    <th className="p-3 uppercase text-right">Calculated Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((fill) => (
                    <tr key={fill.id} className="border-b border-[#1b1b22] hover:bg-[#141419] transition">
                      <td className="p-3 text-[#8c8c9a] whitespace-nowrap">
                        {new Date(fill.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3 font-bold text-white whitespace-nowrap">
                        {fill.orderId}
                      </td>
                      <td className="p-3 text-[#8c8c9a] whitespace-nowrap">
                        {fill.brokerFillId || "sim_direct"}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap text-white font-bold">
                        ${fill.price}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap text-[#00FF66] font-bold">
                        {fill.quantity}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap text-[#ff8c8c]">
                        {fill.fee} {fill.feeCurrency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {resolveMfaModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0a0a0c] border border-[#232329] w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="bg-[#141419] px-4 py-3 border-b border-[#232329] flex justify-between items-center">
              <h3 className="text-[#8c8c9a] font-mono text-xs uppercase tracking-widest font-bold flex items-center gap-2">
                <Key className="w-4 h-4 text-[#00FF66]" />
                Resolve Order MFA
              </h3>
            </div>
            <div className="p-6 space-y-4 font-mono">
              <p className="text-xs text-[#6e6e7a]">
                Resolving order <span className="text-white break-all">{resolveMfaModal.clientOrderId}</span> with action <span className="text-[#00FF66]">{resolveMfaModal.resolutionAction}</span>.
              </p>
              
              {resolveMfaModal.resolutionAction === "attachBrokerOrderId" && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-[#8c8c9a] font-bold">Broker Order ID</label>
                  <input
                    type="text"
                    value={resolveMfaModal.brokerOrderId || ""}
                    onChange={(e) => setResolveMfaModal({ ...resolveMfaModal, brokerOrderId: e.target.value })}
                    className="w-full bg-[#141419] border border-[#232329] text-white text-xs p-2 outline-none focus:border-[#00FF66] transition-colors"
                    placeholder="Enter explicit broker order id"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-[#8c8c9a] font-bold">Authenticator Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={resolveMfaModal.tokenInput}
                  onChange={(e) => setResolveMfaModal({ ...resolveMfaModal, tokenInput: e.target.value.replace(/\D/g, '') })}
                  className="w-full bg-[#141419] border border-[#232329] text-white text-xs p-2 outline-none focus:border-[#00FF66] transition-colors text-center tracking-[0.5em] text-lg font-bold"
                  placeholder="000000"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setResolveMfaModal({ isOpen: false, clientOrderId: "", resolutionAction: "", tokenInput: "" })}
                  className="flex-1 px-4 py-2 bg-[#141419] hover:bg-[#1a1a24] text-[#8c8c9a] text-xs font-bold transition-colors border border-[#232329]"
                >
                  CANCEL
                </button>
                <button 
                  onClick={async () => {
                    try {
                      const payload = {
                        clientOrderId: resolveMfaModal.clientOrderId,
                        resolutionAction: resolveMfaModal.resolutionAction,
                        brokerOrderId: resolveMfaModal.brokerOrderId || ""
                      };
                      
                      const verifyRes = await apiFetch("/api/auth/verify-totp", {
                        method: "POST",
                        body: JSON.stringify({
                          code: resolveMfaModal.tokenInput,
                          action: "RESOLVE_ORDER",
                          payload
                        })
                      });
                      
                      const verifyData = await verifyRes.json();
                      if (!verifyData.success || !verifyData.actionToken) {
                        alert("MFA Verification Failed: " + (verifyData.error || "Invalid token"));
                        return;
                      }
                      
                      const resolveRes = await apiFetch(`/api/orders/${resolveMfaModal.clientOrderId}/manual-resolve`, {
                        method: "POST",
                        body: JSON.stringify({
                          actionToken: verifyData.actionToken,
                          resolutionAction: resolveMfaModal.resolutionAction,
                          brokerOrderId: resolveMfaModal.brokerOrderId
                        })
                      });
                      
                      if (resolveRes.ok) {
                        setResolveMfaModal({ isOpen: false, clientOrderId: "", resolutionAction: "", tokenInput: "" });
                        // Refresh orders
                        const ordersRes = await apiFetch("/api/orders");
                        if (ordersRes.ok) setOrders(await ordersRes.json());
                      } else {
                        const data = await resolveRes.json();
                        alert("Failed to resolve order: " + data.error);
                      }
                    } catch (e: any) {
                      alert("Error: " + e.message);
                    }
                  }}
                  disabled={resolveMfaModal.tokenInput.length !== 6 || (resolveMfaModal.resolutionAction === "attachBrokerOrderId" && !resolveMfaModal.brokerOrderId)}
                  className="flex-1 px-4 py-2 bg-[#00FF66]/10 hover:bg-[#00FF66]/20 text-[#00FF66] border border-[#00FF66]/30 text-xs font-bold transition-colors disabled:opacity-50"
                >
                  AUTHORIZE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
