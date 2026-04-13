import { useRef, useEffect, useState, useMemo } from 'react';
import { BookOpen, Loader2, Square, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

export interface ProjectDocumentation {
  generatedAt: string;
  projectName: string;
  overview: string;
  architecture: string;
  modules: Array<{
    name: string;
    path: string;
    description: string;
    responsibilities: string[];
    keyFiles: string[];
  }>;
  apiSurface: string;
  dataModels: string;
  developerGuide: string;
  techStack: string;
}

interface DocumentationTabProps {
  projectId: string;
  documentation: ProjectDocumentation | null;
  isGenerating: boolean;
  streamChunk: string;
  error: string | null;
  onGenerate: () => void;
  onStop: () => void;
}

const NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'modules', label: 'Modules' },
  { id: 'apiSurface', label: 'API Surface' },
  { id: 'dataModels', label: 'Data Models' },
  { id: 'developerGuide', label: 'Developer Guide' },
  { id: 'techStack', label: 'Tech Stack' },
] as const;

const markdownComponents = {
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      {...props}
    >
      {children}
    </a>
  ),
};

function MarkdownSection({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ModuleCard({ module }: { module: ProjectDocumentation['modules'][number] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="border border-border">
      <CardHeader
        className="py-3 px-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium truncate">{module.name}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{module.path}</p>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{module.description}</p>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-3">
          {module.responsibilities.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Responsibilities
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {module.responsibilities.map((r, i) => (
                  <li key={i} className="text-xs text-foreground/80">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {module.keyFiles.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Key Files
              </p>
              <div className="flex flex-wrap gap-1">
                {module.keyFiles.map((f) => (
                  <span
                    key={f}
                    className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function StreamPreview({ chunk }: { chunk: string }) {
  const containerRef = useRef<HTMLPreElement>(null);

  // Show last ~30 lines
  const visibleLines = useMemo(() => {
    const lines = chunk.split('\n');
    return lines.slice(Math.max(0, lines.length - 30)).join('\n');
  }, [chunk]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  // Detect recent tool use (lines starting with tool indicators)
  const recentTool = useMemo(() => {
    const lines = chunk.split('\n');
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
      const line = lines[i];
      if (line && (line.startsWith('[Tool:') || line.includes('Using tool:'))) {
        return line.replace(/^\[Tool:\s*/, '').replace(/\].*$/, '').trim();
      }
    }
    return null;
  }, [chunk]);

  return (
    <div className="space-y-2">
      {recentTool && (
        <div className="flex items-center gap-1.5">
          <Wrench className="h-3 w-3 text-primary" />
          <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-mono">
            {recentTool}
          </span>
        </div>
      )}
      <pre
        ref={containerRef}
        className="text-xs font-mono bg-card border border-border rounded-lg p-4 overflow-auto max-h-72 text-muted-foreground whitespace-pre-wrap leading-relaxed"
      >
        {visibleLines || 'Starting...'}
      </pre>
    </div>
  );
}

export function DocumentationTab({
  documentation,
  isGenerating,
  streamChunk,
  error,
  onGenerate,
  onStop,
}: DocumentationTabProps) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeSection, setActiveSection] = useState<string>('overview');

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const formattedDate = useMemo(() => {
    if (!documentation?.generatedAt) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(documentation.generatedAt));
    } catch {
      return documentation.generatedAt;
    }
  }, [documentation?.generatedAt]);

  // Empty state
  if (!documentation && !isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No documentation yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          AI will deeply explore your codebase and generate comprehensive documentation
        </p>
        {error && (
          <div className="mb-4 max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive text-left">
            <p className="font-medium mb-1">Generation failed</p>
            <p className="text-xs text-destructive/80">{error}</p>
          </div>
        )}
        <Button onClick={onGenerate}>
          <BookOpen className="h-4 w-4 mr-2" />
          Generate Documentation
        </Button>
      </div>
    );
  }

  // Generating state
  if (isGenerating) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">Generating documentation...</span>
          </div>
          <Button variant="outline" size="sm" onClick={onStop}>
            <Square className="h-3.5 w-3.5 mr-1.5" />
            Stop
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <StreamPreview chunk={streamChunk} />
        </div>
      </div>
    );
  }

  // Complete state
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky section nav */}
      <div className="shrink-0 border-b border-border px-6 py-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {NAV_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                activeSection === section.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-6 space-y-8">
          {/* Overview */}
          <section
            id="overview"
            ref={(el) => { sectionRefs.current['overview'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.overview} />
              </CardContent>
            </Card>
          </section>

          {/* Architecture */}
          <section
            id="architecture"
            ref={(el) => { sectionRefs.current['architecture'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Architecture</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.architecture} />
              </CardContent>
            </Card>
          </section>

          {/* Modules */}
          <section
            id="modules"
            ref={(el) => { sectionRefs.current['modules'] = el; }}
          >
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Modules</h3>
              {documentation!.modules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No modules documented.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {documentation!.modules.map((mod) => (
                    <ModuleCard key={mod.path} module={mod} />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* API Surface */}
          <section
            id="apiSurface"
            ref={(el) => { sectionRefs.current['apiSurface'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API Surface</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.apiSurface} />
              </CardContent>
            </Card>
          </section>

          {/* Data Models */}
          <section
            id="dataModels"
            ref={(el) => { sectionRefs.current['dataModels'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data Models</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.dataModels} />
              </CardContent>
            </Card>
          </section>

          {/* Developer Guide */}
          <section
            id="developerGuide"
            ref={(el) => { sectionRefs.current['developerGuide'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Developer Guide</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.developerGuide} />
              </CardContent>
            </Card>
          </section>

          {/* Tech Stack */}
          <section
            id="techStack"
            ref={(el) => { sectionRefs.current['techStack'] = el; }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tech Stack</CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownSection content={documentation!.techStack} />
              </CardContent>
            </Card>
          </section>

          {/* Footer */}
          {formattedDate && (
            <p className="text-xs text-muted-foreground text-center pb-2">
              Last generated: {formattedDate}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
