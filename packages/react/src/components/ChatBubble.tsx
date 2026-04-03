import type { ChatMessage } from "@clichat/core";

export interface ChatBubbleProps {
  message: ChatMessage;
  /** Custom markdown renderer. Falls back to plain text. */
  renderMarkdown?: (content: string) => React.ReactNode;
}

export function ChatBubble({ message, renderMarkdown }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isThinking = message.type === "thinking";
  const isToolUse = message.type === "tool_use";
  const isError = message.type === "error";
  const isStreaming = message.metadata?.isStreaming;

  const className = [
    "clichat-bubble",
    `clichat-bubble--${message.role}`,
    isThinking && "clichat-bubble--thinking",
    isToolUse && "clichat-bubble--tool",
    isError && "clichat-bubble--error",
    isStreaming && "clichat-bubble--streaming",
  ]
    .filter(Boolean)
    .join(" ");

  const content = renderMarkdown
    ? renderMarkdown(message.content)
    : message.content;

  return (
    <div className={className}>
      <div className="clichat-bubble__role">
        {isUser ? "You" : message.role === "tool" ? "Tool" : "AI"}
      </div>
      <div className="clichat-bubble__content">
        {isThinking && (
          <div className="clichat-bubble__thinking-label">Thinking...</div>
        )}
        {isToolUse && message.metadata?.toolName && (
          <div className="clichat-bubble__tool-label">
            Using: {message.metadata.toolName}
          </div>
        )}
        {content}
      </div>
      {isStreaming && (
        <span className="clichat-bubble__cursor" />
      )}
    </div>
  );
}
