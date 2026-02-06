import { toast } from 'svelte-sonner';

/**
 * Typed notification helpers wrapping svelte-sonner.
 * Use these throughout the portal for consistent toast UX.
 */

/** Tool execution completed successfully. */
export function notifyToolSuccess(toolName: string, message?: string) {
	toast.success(message ?? `${toolName} completed`, {
		description: toolName
	});
}

/** Tool execution failed. */
export function notifyToolError(toolName: string, error?: string) {
	toast.error(`${toolName} failed`, {
		description: error ?? 'An unexpected error occurred'
	});
}

/** Rate limit exceeded. */
export function notifyRateLimit(retryAfter?: number) {
	toast.warning('Rate limit exceeded', {
		description: retryAfter
			? `Please wait ${retryAfter}s before retrying`
			: 'Please wait before retrying'
	});
}

/** Authentication error or session expired. */
export function notifyAuthError(message?: string) {
	toast.error(message ?? 'Authentication required', {
		description: 'Please sign in to continue'
	});
}

/** Session saved/created. */
export function notifySessionSaved(title?: string) {
	toast.success('Session saved', {
		description: title ?? 'Your chat session has been saved'
	});
}

/** Session deleted. */
export function notifySessionDeleted() {
	toast.success('Session deleted');
}

/** Generic info notification. */
export function notifyInfo(message: string, description?: string) {
	toast.info(message, { description });
}

/** Generic error notification. */
export function notifyError(message: string, description?: string) {
	toast.error(message, { description });
}
