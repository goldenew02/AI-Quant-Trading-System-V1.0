import React, { useState } from "react";
import { Bot, RefreshCw, Send, Sparkles, Brain, CheckCircle, ShieldAlert } from "lucide-react";

interface AuditCopilotProps {
  activeBotId?: string;
  backtestData?: any;
}

export default function AuditCopilot({ activeBotId, backtestData }: AuditCopilotProps) {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const performAudit = async (userInput: string) => {
    if (!userInput.trim()) return;

    try {
      setLoading(true);
      setResponse(null);

      const res = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userInput,
          botId: activeBotId,
          backtestResult: backtestData,
        }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setResponse(data.analysis);
      } else {
        setResponse("Error: Gemini API backend returned an invalid status. Trace configuration parameters.");
      }
    } catch (err: any) {
      console.error(err);
      setResponse(`通信故障: 无法联系量化AI后端。错误信息: ${err.message || "未知原因"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestClick = (suggestion: string) => {
    setPrompt(suggestion);
    performAudit(suggestion);
  };

  const parseMarkdown = (text: string) => {
    // Converts basic markdown tags into styled clean HTML segments safely without library overhead
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      let content = line;
      let className = "text-sm text-slate-300 leading-relaxed mb-1.5";

      if (line.startsWith("### ")) {
        content = line.replace("### ", "");
        className = "text-sm font-bold text-slate-100 mt-4 mb-2 border-l-2 border-emerald-500 pl-2";
      } else if (line.startsWith("## ")) {
        content = line.replace("## ", "");
        className = "text-base font-bold text-white mt-5 mb-2.5 border-b border-slate-800 pb-1";
      } else if (line.startsWith("# ")) {
        content = line.replace("# ", "");
        className = "text-lg font-extrabold text-white mt-6 mb-3";
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        content = "• " + line.substring(2);
        className = "text-sm text-slate-350 list-inside pl-3 mb-1 font-sans";
      }

      // Strong parsing
      const strongReg = /\*\*(.*?)\*\*/g;
      const parsedParts = [];
      let lastIdx = 0;
      let match;

      while ((match = strongReg.exec(content)) !== null) {
        if (match.index > lastIdx) {
          parsedParts.push(content.substring(lastIdx, match.index));
        }
        parsedParts.push(
          <strong key={match.index} className="text-emerald-400 font-semibold font-sans">
            {match[1]}
          </strong>
        );
        lastIdx = strongReg.lastIndex;
      }

      if (lastIdx < content.length) {
        parsedParts.push(content.substring(lastIdx));
      }

      const inlineContent = parsedParts.length > 0 ? parsedParts : content;

      return (
        <p key={idx} className={className}>
          {inlineContent}
        </p>
      );
    });
  };

  const suggestions = [
    { label: "推荐现货网格参数", value: "为 BTC/USDT 现货网格推荐一套中等风险的网格设置（包含区间范围、网格数、安全投资额度，并给出止损建议）。" },
    { label: "审计活动机器人风险", value: "请审查我目前运行中的网格交易量化机器人设置。它们在极端单边行情下有什么爆仓或穿仓风险？" },
    { label: "美股网格设置方法", value: "为老虎/长桥上的 NVDA (英伟达) 设计一套股票现货网格部署指导（包含如何规避美股非7*24h带来的开盘跳空滑点问题）。" },
    { label: "安全杠杆配置指导", value: "进行合约网格时，如何根据最大波动回撤和日均波幅(ATR)科学设置防爆仓的安全杠杆系数？" },
  ];

  return (
    <div className="bg-[#141416] border border-[#2A2A2C] rounded-none p-6 mb-6 text-[#E0E0E0] shadow-none relative overflow-none">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5 border-b border-[#2A2A2C] pb-4">
        <div>
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#666666] font-bold block mb-1">
            Gemini Quant Diagnostic Board
          </span>
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-white font-display flex items-center gap-2">
            Aegis AI Audit Copilot
          </h2>
          <p className="text-xs text-[#666666] mt-1 font-mono uppercase">
            Inquire Gemini cognitive algorithms to evaluate current risk positions and calibrate spot parameters.
          </p>
        </div>

        <span className="text-[9px] bg-[#0A0A0B] text-[#00FF66] border border-[#2A2A2C] px-2 py-1 font-black font-mono uppercase tracking-wider block">
          Gemini 3.5 Active
        </span>
      </div>

      {/* Suggestion capsules */}
      <div className="flex flex-wrap gap-2 mb-5 relative z-10">
        {suggestions.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSuggestClick(s.value)}
            className="text-[10px] bg-[#0A0A0B] hover:bg-[#00FF66] hover:text-black hover:border-transparent text-[#E0E0E0] px-3 py-1.5 rounded-none border border-[#2A2A2C] transition-all duration-155 font-mono uppercase font-bold cursor-pointer"
            id={`suggest-${idx}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Chat screen / response display */}
      <div className="bg-[#0A0A0B] border border-[#2A2A2C] rounded-none p-5 mb-5 min-h-[140px] max-h-[380px] overflow-y-auto font-sans relative z-10 scrollbar-thin">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <RefreshCw className="animate-spin text-[#00FF66] h-6 w-6" />
            <p className="text-[10px] text-[#666666] animate-pulse font-mono uppercase font-black">
              [GEMINI ENGINE] PARALYZING RISK HISTORIES & FORMULATING RECOMMENDATIONS...
            </p>
          </div>
        ) : response ? (
          <div className="prose prose-invert max-w-none text-zinc-350">
            {parseMarkdown(response)}
            <div className="mt-5 border-t border-[#141416] pt-3.5 flex items-center gap-1.5 text-[9px] text-[#666666] font-mono uppercase font-bold">
              <CheckCircle className="h-4.5 w-4.5 text-[#00FF66]" />
              Audit trace complete. Recalibrate limits on your Risk setup panel if required.
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-550 gap-2.5">
            <Bot className="h-9 w-9 text-[#666666]" />
            <p className="text-[10px] text-center max-w-sm font-mono uppercase tracking-tight text-[#666666] font-bold">
              Input a proprietary trading inquiry or trigger one of the diagnostic presets above to instruct Gemini.
            </p>
          </div>
        )}
      </div>

      {/* Input section */}
      <div className="flex gap-2 relative z-10">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && performAudit(prompt)}
          placeholder="Consult Gemini: e.g. Recommend grid layout for high volatility, audit system slip rates..."
          className="flex-1 bg-[#0A0A0B] text-white text-xs border border-[#2A2A2C] rounded-none px-4 py-2.5 focus:outline-none focus:border-[#00FF66] font-mono"
          id="auditor-prompt-input"
        />
        <button
          onClick={() => performAudit(prompt)}
          disabled={loading || !prompt.trim()}
          className="bg-[#00FF66] hover:bg-[#00CC55] disabled:bg-[#141416] disabled:text-[#666666] disabled:border-[#2A2A2C] border border-transparent disabled:cursor-not-allowed text-black py-2 px-6 rounded-none transition duration-150 flex items-center justify-center cursor-pointer text-xs font-black uppercase tracking-wider font-display"
          id="btn-trigger-audit"
        >
          <Send className="h-3.5 w-3.5 mr-1.5 fill-black" />
          CONSULT ADVISOR
        </button>
      </div>
    </div>
  );
}
