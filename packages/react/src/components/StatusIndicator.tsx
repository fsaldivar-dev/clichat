import type { SessionStatus } from "@clichat/core";

export interface StatusIndicatorProps {
  status: SessionStatus;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: "",
  thinking: "Thinking...",
  responding: "Responding...",
  tool_use: "Using tools...",
  error: "Error",
  exited: "Session ended",
};

export function StatusIndicator({ status }: StatusIndicatorProps) {
  if (status === "idle") return null;

  const label = STATUS_LABELS[status];
  const isActive = status === "thinking" || status === "responding" || status === "tool_use";

  return (
    <div className={`clichat-status clichat-status--${status}`}>
      {isActive && <span className="clichat-status__dot" />}
      <span className="clichat-status__label">{label}</span>
    </div>
  );
}
