<script lang="ts">
	import { authClient } from '$lib/auth-client.js';

	function signInWithOCI() {
		authClient.signIn.oauth2({
			providerId: 'oci-iam',
			callbackURL: '/'
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
