
import React from 'react';
import { ErrorReportingService } from '@/services/ErrorReportingService';

interface ComponentErrorBoundaryProps {
  componentType: string;
  componentId?: string;
  children: React.ReactNode;
}

interface ComponentErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary for individual dynamic components.
 * Shows a descriptive fallback with retry instead of crashing the entire app.
 * In development, shows the error message and stack trace.
 */
export class ComponentErrorBoundary extends React.Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ComponentErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[ComponentErrorBoundary] Error in ${this.props.componentType}` +
        (this.props.componentId ? ` (${this.props.componentId})` : '') +
        ':',
      error,
      errorInfo
    );

    // Route the caught error through the reporting service so it lands on a
    // real operator-visible side channel (the `runtime-error` window event +
    // frequency tracking) instead of only console.error. Previously
    // ErrorReportingService had zero call sites and this boundary swallowed
    // production errors silently.
    ErrorReportingService.report(error, {
      componentType: this.props.componentType,
      componentId: this.props.componentId,
      stackTrace: errorInfo.componentStack ?? error.stack,
    });
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.MODE === 'development';

      return (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-700">
            Component Error: {this.props.componentType}
          </p>
          {isDev && this.state.error && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-red-600">
                Error Details
              </summary>
              <pre className="mt-1 overflow-auto rounded bg-red-100 p-2 text-xs text-red-800">
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            className="mt-2 rounded bg-red-100 px-3 py-1 text-sm text-red-700 hover:bg-red-200"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
