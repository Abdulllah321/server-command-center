import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert, RefreshCcw, Home, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatErrorMessage } from '@/lib/error-handler';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
  inline?: boolean;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught component error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      const errorMessage = formatErrorMessage(this.state.error, 'An unexpected rendering error occurred.');
      
      if (this.props.inline) {
        return (
          <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-foreground space-y-4 my-4">
            <div className="flex items-center gap-2.5 text-destructive font-semibold text-base">
              <AlertTriangle className="w-5 h-5" />
              <span>{this.props.fallbackTitle || 'Component Error'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {this.props.fallbackDescription || 'This section failed to render properly.'}
            </p>
            <div className="p-3 bg-black/40 rounded border border-destructive/20 font-mono text-xs text-destructive/90 break-all">
              {errorMessage}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={this.handleReset} className="h-8 text-xs">
                <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center w-full min-h-[60vh] p-6 text-foreground">
          <div className="max-w-lg w-full space-y-6 bg-card p-8 rounded-xl border shadow-lg text-center">
            <div className="flex flex-col items-center space-y-3">
              <div className="p-3 bg-destructive/10 rounded-full text-destructive">
                <ShieldAlert className="w-10 h-10" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {this.props.fallbackTitle || 'Something went wrong'}
              </h1>
              <p className="text-xs text-muted-foreground max-w-sm">
                {this.props.fallbackDescription || 'An unexpected rendering exception was caught. Your data and credentials remain secure.'}
              </p>
            </div>
            
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-left space-y-1">
              <p className="font-semibold text-xs text-destructive">Diagnostics</p>
              <div className="font-mono text-xs overflow-auto max-h-32 break-all text-destructive/90 select-all">
                {errorMessage}
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button 
                variant="outline"
                className="w-full sm:w-auto h-9 text-xs" 
                onClick={this.handleReset}
              >
                <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />
                Retry View
              </Button>
              <Button 
                variant="default"
                className="w-full sm:w-auto h-9 text-xs" 
                onClick={this.handleGoHome}
              >
                <Home className="w-3.5 h-3.5 mr-1.5" />
                Return to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
