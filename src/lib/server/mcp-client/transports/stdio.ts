/**
 * Stdio Transport for MCP
 *
 * Communicates with MCP servers via stdin/stdout using JSON-RPC 2.0.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type {
  MCPTransport,
  StdioServerConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from '../types.js';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class StdioTransport extends EventEmitter implements MCPTransport {
  private config: StdioServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private buffer = '';
  private connected = false;
  private timeout: number;
  private notificationHandler?: (method: string, params?: Record<string, unknown>) => void;

  constructor(config: StdioServerConfig, timeout = 30000) {
    super();
    this.config = config;
    this.timeout = timeout;
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Transport already started');
    }

    return new Promise((resolve, reject) => {
      const { command, args = [], env, cwd } = this.config;

      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd,
      });

      this.process.on('error', (error) => {
        this.connected = false;
        this.emit('error', error);
        reject(error);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('close', code);
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Process closed with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      // Handle stdout (responses and notifications)
      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      // Handle stderr (logging)
      this.process.stderr?.on('data', (data: Buffer) => {
        this.emit('log', 'stderr', data.toString());
      });

      // Consider connected once process is spawned
      this.connected = true;
      resolve();
    });
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      const proc = this.process;
      this.process = null;
      this.connected = false;

      // Clear pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Transport stopped'));
      }
      this.pendingRequests.clear();

      // Kill process
      if (proc && !proc.killed) {
        proc.on('close', () => resolve());
        proc.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      } else {
        resolve();
      }
    });
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.process || !this.connected) {
      throw new Error('Transport not connected');
    }

    const id = ++this.requestId;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(request);
    });
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.process || !this.connected) {
      throw new Error('Transport not connected');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.send(notification);
  }

  onNotification(handler: (method: string, params?: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }

  isConnected(): boolean {
    return this.connected && this.process !== null;
  }

  private send(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.process?.stdin) {
      throw new Error('Process stdin not available');
    }

    const data = JSON.stringify(message) + '\n';
    this.process.stdin.write(data);
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines (JSON-RPC messages are newline-delimited)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch {
          this.emit('log', 'warn', `Failed to parse message: ${line}`);
        }
      }
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // Check if it's a response (has id)
    if ('id' in message && message.id !== null) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(`${response.error.message} (${response.error.code})`));
        } else {
          pending.resolve(response.result);
        }
      }
    } else {
      // It's a notification
      const notification = message as JsonRpcNotification;
      this.notificationHandler?.(notification.method, notification.params);
      this.emit('notification', notification.method, notification.params);
    }
  }
}
