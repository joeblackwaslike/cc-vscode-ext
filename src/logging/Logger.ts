import * as vscode from 'vscode';

/** Extension-wide output channel for logging. Only one instance should exist per activation. */
export class Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(channelName = 'Claw Code') {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  info(message: string): void {
    this.channel.appendLine(`[INFO]  ${message}`);
  }

  warn(message: string): void {
    this.channel.appendLine(`[WARN]  ${message}`);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? ` — ${err.message}` : err != null ? ` — ${String(err)}` : '';
    this.channel.appendLine(`[ERROR] ${message}${detail}`);
  }

  /** Show the output panel. */
  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
