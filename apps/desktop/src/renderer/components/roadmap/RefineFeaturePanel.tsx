import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { X, Send, Loader2, Sparkles, User, Bot, WrenchIcon, Plus, CheckCheck } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { useFeatureRefineStore } from '../../stores/feature-refine-store';
import type { FeatureRefineResult } from '../../stores/feature-refine-store';

export interface RefineFeaturePanelProps {
  projectId: string;
  onAddToRoadmap: (result: FeatureRefineResult) => void;
  onClose: () => void;
}

// Markdown rendering components matching the Insights pattern
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

export function RefineFeaturePanel({ projectId, onAddToRoadmap, onClose }: RefineFeaturePanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    streamingContent,
    currentTool,
    status,
    error,
    result,
    featureContext,
    addUserMessage,
    appendChunk,
    finalizeAssistantMessage,
    setCurrentTool,
    setComplete,
    setError,
  } = useFeatureRefineStore();

  // Auto-start the session immediately on mount (AI sends the first question)
  useEffect(() => {
    window.electronAPI.roadmapRefineStart(
      projectId,
      undefined,
      featureContext ?? undefined,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register IPC listeners on mount, clean up on unmount
  useEffect(() => {
    const unsubChunk = window.electronAPI.onRoadmapRefineChunk((pid, chunk) => {
      if (pid !== projectId) return;
      appendChunk(chunk);
    });

    const unsubToolUse = window.electronAPI.onRoadmapRefineToolUse((pid, toolName) => {
      if (pid !== projectId) return;
      setCurrentTool(toolName);
    });

    const unsubComplete = window.electronAPI.onRoadmapRefineComplete((pid, refineResult) => {
      if (pid !== projectId) return;
      finalizeAssistantMessage();
      setComplete(refineResult);
    });

    const unsubError = window.electronAPI.onRoadmapRefineError((pid, err) => {
      if (pid !== projectId) return;
      finalizeAssistantMessage();
      setError(err);
    });

    return () => {
      unsubChunk();
      unsubToolUse();
      unsubComplete();
      unsubError();
    };
  }, [projectId, appendChunk, finalizeAssistantMessage, setCurrentTool, setComplete, setError]);

  // Auto-scroll to bottom when messages or streaming content changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || status === 'thinking' || status === 'streaming') return;

    addUserMessage(text);
    setInputText('');
    window.electronAPI.roadmapRefineSend(projectId, text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isProcessing = status === 'thinking' || status === 'streaming';
  const canFinish = !isProcessing && messages.length >= 2 && status !== 'complete';

  // Auto-apply and close when refining an existing feature and featureData arrives
  useEffect(() => {
    if (featureContext && status === 'complete' && result) {
      onAddToRoadmap(result);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, result]);

  const handleFinish = () => {
    const finishMessage = 'Please synthesize the refined feature details now and output the feature_data block.';
    addUserMessage(finishMessage);
    window.electronAPI.roadmapRefineSend(projectId, finishMessage);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border shadow-xl flex flex-col z-[60]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border electron-no-drag">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold text-sm">
              {featureContext ? 'Refine Feature' : 'New Feature'}
            </span>
            {featureContext && (
              <p className="text-xs text-muted-foreground truncate">{featureContext.title}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-4">
          {/* Welcome / loading state when session is auto-starting */}
          {messages.length === 0 && !streamingContent && status !== 'thinking' && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                {featureContext
                  ? `I'll refine "${featureContext.title}" with you. Starting session…`
                  : 'Describe a feature you want to add to the roadmap. I\'ll grill you on the details, then generate a PRD and implementation plan.'}
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

          {/* Thinking indicator — shown when waiting for first chunk */}
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

          {/* Error message */}
          {status === 'error' && error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {/* TODO: i18n — add key 'roadmap.refineError' */}
              Error: {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Save button — shown when complete and creating a new feature (existing features auto-apply) */}
      {status === 'complete' && result && !featureContext && (
        <div className="shrink-0 px-4 py-2 border-t border-border">
          <Button
            className="w-full gap-2"
            onClick={() => onAddToRoadmap(result)}
          >
            <Plus className="h-4 w-4" />
            Add to Roadmap
          </Button>
        </div>
      )}

      {/* Footer input */}
      <div className="shrink-0 px-4 py-3 border-t border-border space-y-2">
        {/* Finish button — shown mid-conversation when not processing */}
        {canFinish && (
          <Button
            variant="outline"
            className="w-full gap-2 text-sm"
            onClick={handleFinish}
          >
            <CheckCheck className="h-4 w-4" />
            Finish &amp; Apply
          </Button>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isProcessing
                ? 'AI is thinking...'
                : 'Answer the question or describe changes...'
            }
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
    </div>
  );
}
