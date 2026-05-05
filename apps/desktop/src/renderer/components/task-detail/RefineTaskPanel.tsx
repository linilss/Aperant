import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { X, Send, Loader2, Sparkles, User, Bot, WrenchIcon, CheckCircle2 } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { useTaskRefineStore } from '../../stores/task-refine-store';

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm">{children}</li>,
  code: ({ children, className }) => {
    const isInline = !className;
    return isInline ? (
      <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
    ) : (
      <code className="block bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-2 text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-2 text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 text-foreground">{children}</h3>,
};

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" />
    </div>
  );
}

export interface RefineTaskPanelProps {
  taskId: string;
  taskTitle: string;
  autoMode?: boolean;
  onClose: () => void;
}

export function RefineTaskPanel({ taskId, taskTitle, autoMode = false, onClose }: RefineTaskPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    streamingContent,
    currentTool,
    status,
    error,
    refinedDescription,
    open,
    addUserMessage,
    appendChunk,
    finalizeAssistantMessage,
    setCurrentTool,
    setError,
  } = useTaskRefineStore();

  // Reset store and auto-start session on mount
  useEffect(() => {
    open(taskId, taskTitle);
    window.electronAPI.taskRefineStart(taskId, autoMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register IPC listeners
  useEffect(() => {
    const unsubChunk = window.electronAPI.onTaskRefineChunk((tid, chunk) => {
      if (tid !== taskId) return;
      appendChunk(chunk);
    });

    const unsubToolUse = window.electronAPI.onTaskRefineToolUse((tid, toolName) => {
      if (tid !== taskId) return;
      setCurrentTool(toolName);
    });

    const unsubComplete = window.electronAPI.onTaskRefineComplete((tid, refinedDesc) => {
      if (tid !== taskId) return;
      finalizeAssistantMessage(refinedDesc);
    });

    const unsubError = window.electronAPI.onTaskRefineError((tid, err) => {
      if (tid !== taskId) return;
      finalizeAssistantMessage();
      setError(err);
    });

    return () => {
      unsubChunk();
      unsubToolUse();
      unsubComplete();
      unsubError();
      if (!autoMode) {
        window.electronAPI.taskRefineStop(taskId);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const isProcessing = status === 'thinking' || status === 'streaming';

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || isProcessing) return;
    addUserMessage(text);
    setInputText('');
    window.electronAPI.taskRefineSend(taskId, text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div data-refine-panel className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border shadow-xl flex flex-col z-[70]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border electron-no-drag">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold text-sm">{autoMode ? 'Auto-refine' : 'Refine'}</span>
            <p className="text-xs text-muted-foreground truncate">{taskTitle}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-4">
          {/* Initial placeholder while AI starts */}
          {messages.length === 0 && !streamingContent && status !== 'thinking' && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                {autoMode
                  ? 'Inspecting the codebase and auto-refining this task…'
                  : 'Exploring the codebase and preparing questions about this task…'}
              </div>
            </div>
          )}

          {/* Rendered messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}
            >
              <div
                className={cn(
                  'shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5',
                  msg.role === 'user' ? 'bg-secondary' : 'bg-primary/10'
                )}
              >
                {msg.role === 'user' ? (
                  <User className="h-4 w-4 text-secondary-foreground" />
                ) : (
                  <Bot className="h-4 w-4 text-primary" />
                )}
              </div>
              <div
                className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-foreground'
                )}
              >
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
            </div>
          ))}

          {/* Tool use indicator */}
          {currentTool && (
            <div className="flex items-center justify-center">
              <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
                <WrenchIcon className="h-3 w-3" />
                {currentTool}...
              </Badge>
            </div>
          )}

          {/* Streaming ghost bubble */}
          {streamingContent && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 bg-muted/50 rounded-lg px-3 py-2 text-sm text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {streamingContent}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {status === 'thinking' && !streamingContent && !currentTool && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted/50 rounded-lg">
                <ThinkingIndicator />
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              Error: {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 border-t border-border">
        {autoMode ? (
          /* Auto mode: status + optional reply + close */
          <div className="space-y-2">
            {/* Show input if AI finished without producing a refined description (e.g., asked a question) */}
            {!isProcessing && !refinedDescription && messages.length > 0 && (
              <div className="flex gap-2">
                <Textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply to continue..."
                  className="resize-none text-sm min-h-[40px] max-h-[80px]"
                  rows={1}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  className="shrink-0 h-10 w-10"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={onClose}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Refining…
                </>
              ) : refinedDescription ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
                  Applied — Close
                </>
              ) : (
                'Close'
              )}
            </Button>
          </div>
        ) : (
          /* Interactive mode: apply button + reply textarea */
          <div className="space-y-2">
            {refinedDescription ? (
              /* Applied — show confirmation */
              <Button variant="outline" className="w-full gap-2" onClick={onClose}>
                <CheckCircle2 className="h-4 w-4 text-success" />
                Applied — Close
              </Button>
            ) : messages.length >= 2 && !isProcessing && (
              /* Show "Apply" once there's a conversation to synthesise */
              <Button
                variant="outline"
                className="w-full gap-2 text-sm"
                onClick={() => {
                  const synthesis = 'Based on our discussion, please synthesize a comprehensive refined task description and output it inside a <refined_description> block.';
                  addUserMessage(synthesis);
                  window.electronAPI.taskRefineSend(taskId, synthesis);
                }}
              >
                <CheckCircle2 className="h-4 w-4" />Apply to task
              </Button>
            )}
            <div className="flex gap-2 items-end">
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isProcessing ? 'AI is thinking...' : 'Answer the question…'}
                disabled={isProcessing}
                rows={2}
                className="flex-1 resize-none min-h-0 text-sm"
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!inputText.trim() || isProcessing}
                className="shrink-0 h-9 w-9"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
