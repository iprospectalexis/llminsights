import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors inside a dashboard tab and shows a
 * readable error card instead of unmounting the whole page to a white
 * screen. Keyed by activeTab at the call site, so switching tabs (or
 * pressing the reload button) retries a clean render.
 */
export class TabErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Tab render crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="max-w-md text-center space-y-3">
            <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              This report failed to render
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
              {this.state.error.message}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand-primary hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="w-4 h-4" />
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
