// Keeps a render error in one page from blanking the whole editor: shows the message and a "try again" button.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error" role="alert">
        <p>This page failed to render: {error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>try again</button>
      </div>
    );
  }
}
