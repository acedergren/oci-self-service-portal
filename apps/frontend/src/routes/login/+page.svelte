<script lang="ts">
	import { page } from '$app/stores';
	import { authClient } from '$lib/auth-client.js';

	// Sanitize redirectTo to prevent open-redirect attacks — only relative paths allowed
	function getCallbackURL(): string {
		const raw = $page.url.searchParams.get('redirectTo');
		if (!raw) return '/';
		// Must start with / and must not start with // (protocol-relative URL)
		if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
		return '/';
	}

	// Parse ?error= for user-friendly auth failure messages
	const ERROR_MESSAGES: Record<string, string> = {
		auth_failed: 'Authentication failed. Please try again.',
		invalid_state: 'Login session expired. Please try again.',
		session_expired: 'Your session has expired. Please sign in again.'
	};

	// Reference $page directly so Svelte can track the reactive dependency
	$: errorCode = $page.url.searchParams.get('error');
	$: errorMessage = errorCode
		? (ERROR_MESSAGES[errorCode] ?? 'An unexpected error occurred. Please try again.')
		: null;

	function signInWithOCI() {
		authClient.signIn.oauth2({
			providerId: 'oci-iam',
			callbackURL: getCallbackURL()
		});
	}
</script>

<div class="login-page">
	<div class="login-card glass-charlie">
		<div class="login-logo">
			<div class="logo-diamond">&#9670;</div>
		</div>

		<h1 class="login-title">CloudNow</h1>
		<p class="login-subtitle">Cloud operations powered by AI</p>

		{#if errorMessage}
			<div class="login-error" role="alert">{errorMessage}</div>
		{/if}

		<button class="btn btn-primary login-btn" onclick={signInWithOCI}>
			Sign in with OCI IAM
		</button>

		<p class="login-footer">Manage your Oracle Cloud resources with natural language.</p>
	</div>
</div>

<style>
	.login-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: var(--space-lg);
	}

	.login-card {
		width: 100%;
		max-width: 400px;
		padding: var(--space-xxl) var(--space-xl);
		text-align: center;
		border-radius: var(--radius-xl);
	}

	.login-logo {
		margin-bottom: var(--space-lg);
	}

	.logo-diamond {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		font-size: 2rem;
		color: var(--accent-primary);
		background: var(--bg-elevated);
		border-radius: var(--radius-lg);
		box-shadow: 0 0 24px -4px color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}

	.login-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
	}

	.login-subtitle {
		font-size: var(--text-sm);
		color: var(--fg-secondary);
		margin-bottom: var(--space-xl);
	}

	.login-error {
		padding: var(--space-sm) var(--space-md);
		margin-bottom: var(--space-lg);
		font-size: var(--text-sm);
		color: var(--status-error, #dc2626);
		background: color-mix(in srgb, var(--status-error, #dc2626) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--status-error, #dc2626) 30%, transparent);
		border-radius: var(--radius-md);
	}

	.login-btn {
		width: 100%;
		padding: var(--space-md) var(--space-lg);
		font-size: var(--text-base);
		font-weight: 600;
	}

	.login-footer {
		margin-top: var(--space-lg);
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}
</style>
