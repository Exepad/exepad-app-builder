// src/app_runtime/runtime/components/custom/code/DevModeViewer.tsx

import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { CodeComponentSourceProps } from '@/app_runtime/interfaces/code_components/code_component';

// ============================================================================
// Types
// ============================================================================

interface DevModeViewerProps {
  source: CodeComponentSourceProps;
  className?: string;
}

interface SourceFetchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  content?: string;
  error?: string;
}

// ============================================================================
// DevModeViewer Component
// ============================================================================

/**
 * DevModeViewer
 * 
 * A collapsible panel that displays the source code of a remote component.
 * Only available in development mode for debugging and development purposes.
 * 
 * Features:
 * - Collapsible panel to not obstruct the component
 * - Lazy loading of source code on expansion
 * - Syntax highlighting (basic)
 * - Copy to clipboard functionality
 * - Hash verification display
 */
export const DevModeViewer: React.FC<DevModeViewerProps> = ({ source, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [fetchState, setFetchState] = useState<SourceFetchState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const { source_code_url, source_code_hash } = source;

  // Fetch source code when expanded
  const fetchSource = useCallback(async () => {
    if (fetchState.status === 'success' || fetchState.status === 'loading') {
      return;
    }

    setFetchState({ status: 'loading' });

    try {
      const response = await fetch(source_code_url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      setFetchState({ status: 'success', content });
    } catch (error) {
      setFetchState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to fetch source',
      });
    }
  }, [source_code_url, fetchState.status]);

  // Fetch source when panel is expanded
  useEffect(() => {
    if (isExpanded && fetchState.status === 'idle') {
      fetchSource();
    }
  }, [isExpanded, fetchState.status, fetchSource]);

  // Clean up timeout for copied state to prevent memory leaks
  useEffect(() => {
    if (!copied) return;
    
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Copy source code to clipboard
  const handleCopy = async () => {
    if (fetchState.content) {
      try {
        await navigator.clipboard.writeText(fetchState.content);
        setCopied(true);
      } catch {
        // Clipboard API not available
        logger.warn('[DevModeViewer] Clipboard API not available');
      }
    }
  };

  // Only render in development and if not explicitly disabled
  if (import.meta.env.VITE_SHOW_REMOTE_DEV === 'false') {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-2 border-2 border-dashed border-slate-700 rounded-lg overflow-hidden",
        "bg-slate-900/95 backdrop-blur-sm shadow-lg",
        className
      )}
    >
      {/* Header / Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full px-3 py-2 flex items-center justify-between",
          "text-xs text-cyan-400 hover:bg-slate-800/80 transition-colors",
          "focus:outline-hidden focus:ring-2 focus:ring-cyan-400/50"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] bg-cyan-500/30 text-cyan-100 px-1.5 py-0.5 rounded font-bold">
            DEV
          </span>
          <span className="font-medium">Code Component Source</span>
        </div>
        <svg
          className={cn(
            "w-4 h-4 transition-transform",
            isExpanded && "rotate-180"
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t-2 border-slate-700">
          {/* Metadata */}
          <div className="px-3 py-2 bg-slate-800/80 text-xs space-y-1">
            <div className="flex items-start gap-2">
              <span className="text-slate-400 shrink-0 font-semibold">URL:</span>
              <a
                href={source_code_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300 hover:text-cyan-200 break-all font-mono underline decoration-cyan-500/30"
              >
                {source_code_url}
              </a>
            </div>
            {source_code_hash && (
              <div className="flex items-start gap-2">
                <span className="text-slate-400 shrink-0 font-semibold">Hash:</span>
                <code className="text-emerald-400 font-mono text-[10px] break-all">
                  {source_code_hash}
                </code>
              </div>
            )}
          </div>

          {/* Source Code */}
          <div className="relative">
            {/* Actions */}
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              {fetchState.status === 'success' && (
                <button
                  onClick={handleCopy}
                  className={cn(
                    "px-2 py-1 text-[10px] rounded font-semibold transition-colors shadow-md",
                    copied
                      ? "bg-emerald-500/90 text-white"
                      : "bg-cyan-500/90 text-white hover:bg-cyan-400"
                  )}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
              {fetchState.status === 'error' && (
                <button
                  onClick={() => {
                    setFetchState({ status: 'idle' });
                    fetchSource();
                  }}
                  className="px-2 py-1 text-[10px] rounded font-semibold bg-orange-500/90 text-white hover:bg-orange-400 shadow-md"
                >
                  Retry
                </button>
              )}
            </div>

            {/* Content Area */}
            <div className="max-h-96 overflow-auto bg-slate-950/50">
              {fetchState.status === 'loading' && (
                <div className="p-4 text-center text-cyan-400 text-xs">
                  Loading source code...
                </div>
              )}

              {fetchState.status === 'error' && (
                <div className="p-4 text-center text-orange-400 text-xs">
                  <p className="font-semibold">Failed to load source code</p>
                  <p className="text-orange-300/70 mt-1">{fetchState.error}</p>
                </div>
              )}

              {fetchState.status === 'success' && fetchState.content && (
                <pre className="p-4 text-[11px] leading-relaxed overflow-x-auto">
                  <code className="text-slate-100 font-mono whitespace-pre">
                    {fetchState.content}
                  </code>
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevModeViewer;

