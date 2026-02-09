/**
 * SSE (Server-Sent Events) Transport for MCP
 *
 * Communicates with remote MCP servers via HTTP + SSE.
 * Uses SSE for receiving messages and HTTP POST for sending.
 */

import { EventEmitter } from 'events';
import type {
	MCPTransport,
	SSEServerConfig,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcNotification
} from '../types';

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

export class SSETransport extends EventEmitter implements MCPTransport {
	private config: SSEServerConfig;
	private eventSource: EventSource | null = null;
	private requestId = 0;
	private pendingRequests = new Map<string | number, PendingRequest>();
	private connected = false;
	private timeout: number;
	private notificationHandler?: (method: string, params?: Record<string, unknown>) => void;
	private sessionEndpoint: string | null = null;

	constructor(config: SSEServerConfig, timeout = 30000) {
		super();
		this.config = config;
		this.timeout = timeout;
	}

	async start(): Promise<void> {
		if (this.eventSource) {
			throw new Error('Transport already started');
		}

		// Resolve EventSource implementation before entering Promise constructor.
		// In Node.js, native EventSource is unavailable — use the `eventsource` polyfill.
		let EventSourceImpl: typeof EventSource;
		if (typeof EventSource !== 'undefined') {
			EventSourceImpl = EventSource;
		} else {
			// @ts-expect-error — `eventsource` polyfill has no type declarations
			const mod = await import('eventsource');
			EventSourceImpl = (mod.default ?? mod) as typeof EventSource;
		}

		return new Promise((resolve, reject) => {
			try {
				// The `headers` option is supported by the `eventsource` polyfill
				// but not in the native EventSourceInit interface.
				this.eventSource = new EventSourceImpl(this.config.url, {
					headers: this.config.headers
				} as EventSourceInit) as EventSource;

				const es = this.eventSource;

				es.onopen = () => {
					this.connected = true;
					this.emit('open');
					resolve();
				};

				es.onerror = (error: Event) => {
					this.connected = false;
					this.emit('error', error);
					if (!this.connected) {
						reject(new Error('Failed to connect to SSE server'));
					}
				};

				es.onmessage = (event) => {
					this.handleMessage(event.data);
				};

				// Handle custom event types
				es.addEventListener('endpoint', (event) => {
					// Some MCP servers send the session endpoint via SSE
					const messageEvent = event as MessageEvent;
					if (messageEvent.data) {
						this.sessionEndpoint = messageEvent.data;
					}
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	async stop(): Promise<void> {
		if (!this.eventSource) {
			return;
		}

		this.eventSource.close();
		this.eventSource = null;
		this.connected = false;

		// Clear pending requests
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Transport stopped'));
		}
		this.pendingRequests.clear();
	}

	async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (!this.connected) {
			throw new Error('Transport not connected');
		}

		const id = ++this.requestId;

		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id,
			method,
			params
		};

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, this.timeout);

			this.pendingRequests.set(id, {
				resolve: resolve as (result: unknown) => void,
				reject,
				timeout
			});

			this.sendRequest(request).catch((error) => {
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
				reject(error);
			});
		});
	}

	async notify(method: string, params?: Record<string, unknown>): Promise<void> {
		if (!this.connected) {
			throw new Error('Transport not connected');
		}

		const notification: JsonRpcNotification = {
			jsonrpc: '2.0',
			method,
			params
		};

		await this.sendRequest(notification);
	}

	onNotification(handler: (method: string, params?: Record<string, unknown>) => void): void {
		this.notificationHandler = handler;
	}

	isConnected(): boolean {
		return this.connected;
	}

	private async sendRequest(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
		// Determine the POST endpoint
		// Some servers use /message, some use the session endpoint
		const baseUrl = this.config.url.replace(/\/sse\/?$/, '');
		const postUrl = this.sessionEndpoint || `${baseUrl}/message`;

		const response = await fetch(postUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.config.headers
			},
			body: JSON.stringify(message)
		});

		if (!response.ok) {
			throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
		}
	}

	private handleMessage(data: string): void {
		try {
			const message = JSON.parse(data);

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
		} catch {
			this.emit('log', 'warn', `Failed to parse message: ${data}`);
		}
	}
}
