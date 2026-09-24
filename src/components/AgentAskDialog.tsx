"use client";

export function AgentAskDialog({
  question,
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  question: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-[var(--forge-line)] bg-[color-mix(in_srgb,var(--forge-panel)_95%,transparent)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-orange-300/90">
        Agent is asking
      </p>
      <div className="mb-3 max-h-36 overflow-y-auto rounded-lg border border-orange-400/20 bg-orange-400/5 px-3 py-2 text-sm leading-relaxed text-[var(--forge-bright)] whitespace-pre-wrap">
        {question}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer…"
          enterKeyHint="send"
          autoFocus
          className="min-h-11 flex-1 rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 text-base text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="min-h-11 shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-400 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}
