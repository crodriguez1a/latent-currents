/**
 * In-browser Diagnostic Logger for Latent Currents
 * Intercepts console logs and uncaught errors to display them in a TV-friendly UI overlay.
 */

export class DiagnosticLogger {
  private static logs: string[] = [];
  private static onLogAdded?: (msg: string, type: 'info' | 'warn' | 'error') => void;

  public static init(): void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      originalLog.apply(console, args);
      this.addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '), 'info');
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      this.addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '), 'warn');
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      this.addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '), 'error');
    };

    // Capture uncaught script errors
    window.onerror = (message, source, lineno, colno, error) => {
      const errMsg = `CRITICAL UNCAUGHT: ${message} at ${source}:${lineno}:${colno}${error ? ` - Stack: ${error.stack}` : ''}`;
      this.addLog(errMsg, 'error');
      return false; // Let the browser handle standard error display too
    };

    // Capture unhandled promise rejections (very common in async loading)
    window.onunhandledrejection = (event) => {
      this.addLog(`UNHANDLED PROMISE REJECTION: ${event.reason}`, 'error');
    };

    console.log("DiagnosticLogger initialized successfully.");
  }

  private static addLog(msg: string, type: 'info' | 'warn' | 'error'): void {
    const time = new Date().toISOString().substring(11, 19);
    const formatted = `[${time}] ${msg}`;
    this.logs.push(formatted);
    if (this.onLogAdded) {
      try {
        this.onLogAdded(formatted, type);
      } catch (e) {
        // Prevent recursive errors
      }
    }
  }

  public static getLogs(): string[] {
    return this.logs;
  }

  public static subscribe(callback: (msg: string, type: 'info' | 'warn' | 'error') => void): void {
    this.onLogAdded = callback;
    // Push existing logs to the newly subscribed display
    this.logs.forEach(log => {
      const isError = log.includes('ERROR:') || log.includes('CRITICAL');
      const isWarn = log.includes('WARN:');
      const type = isError ? 'error' : isWarn ? 'warn' : 'info';
      callback(log, type);
    });
  }
}
