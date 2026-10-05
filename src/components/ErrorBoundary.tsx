import { Component, type ReactNode } from 'react';
import { download } from '../lib/export';

interface State {
  error: Error | null;
}

/** Last line of defence: show a way out instead of a blank page if rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap empty-state">
        <h1 className="display">Something went wrong</h1>
        <p className="muted">
          This page couldn't be displayed. Your results are still saved in this browser. Try reloading, and if it keeps happening, download your saved data
          before clearing the site's storage.
        </p>
        <div className="export-row">
          <button className="btn btn-gold" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => download('media-league-saved-data.json', localStorage.getItem('media-league') ?? '{}', 'application/json')}
          >
            Download saved data
          </button>
        </div>
      </div>
    );
  }
}
