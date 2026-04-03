import { useRef, useEffect } from "react";
import type { SessionStatus, ChatMessage } from "@clichat/core";
import { ChatBubble } from "./ChatBubble.js";
import { ChatInput } from "./ChatInput.js";
import { StatusIndicator } from "./StatusIndicator.js";

export interface ChatContainerProps {
  messages: ChatMessage[];
  status: SessionStatus;
  onSend: (text: string) => void;
  onAbort?: () => void;

  /** Custom markdown renderer for message bubbles */
  renderMarkdown?: (content: string) => React.ReactNode;

  /** Placeholder for input */
  placeholder?: string;

  /** Empty state content */
  emptyState?: React.ReactNode;

  /** Header content */
  header?: React.ReactNode;

  /** Additional class name */
  className?: string;
}

export function ChatContainer({
  messages,
  status,
  onSend,
  onAbort,
  renderMarkdown,
  placeholder,
  emptyState,
  header,
  className,
}: ChatContainerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isActive = status === "thinking" || status === "responding" || status === "tool_use";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, status]);

  return (
    <div className={`clichat-container ${className ?? ""}`}>
      {header && <div className="clichat-container__header">{header}</div>}

      <div className="clichat-container__messages" ref={listRef}>
        {messages.length === 0 && emptyState && (
          <div className="clichat-container__empty">{emptyState}</div>
        )}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} renderMarkdown={renderMarkdown} />
        ))}
      </div>

      <div className="clichat-container__footer">
        <StatusIndicator status={status} />
        <ChatInput
          onSend={onSend}
          disabled={status === "exited"}
          placeholder={
            status === "exited"
              ? "Session ended"
              : placeholder
          }
        />
        {isActive && onAbort && (
          <button className="clichat-container__abort" onClick={onAbort} aria-label="Stop">
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
