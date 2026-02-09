/**
 * WebSocket stub for Cloudflare Workers
 *
 * The realtime features of oci-genai-provider require Node.js WebSocket.
 * This stub allows the build to succeed while disabling realtime features.
 */

export default class WebSocket {
	constructor() {
		throw new Error('WebSocket is not available in Cloudflare Workers environment');
	}
}

export { WebSocket };
