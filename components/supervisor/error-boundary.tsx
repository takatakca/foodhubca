'use client';

// Around each page: a crash in one screen never takes down the menu, the new-order pop-up or the cancel alarm.
// The person sees TakTak, their drafts are kept (they live in local storage), and the crash is reported.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { report } from '@/lib/ui/supervisor';
import { CrashCard } from './crash-card';

type Props = { children: ReactNode; resetKey?: string; name?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    report('crash', `${error.name}: ${error.message} ${String(info.componentStack ?? '').split('\n').slice(0, 4).join(' ').trim()}`, this.props.name);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return <CrashCard message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
