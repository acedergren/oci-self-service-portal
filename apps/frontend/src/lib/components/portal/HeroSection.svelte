<script lang="ts">
	import SearchBox from '$lib/components/ui/SearchBox.svelte';
	import { LoadingSpinner } from '@portal/ui';
	import type { HeroSectionProps } from './types.js';

	let { userName, quickActions, loadingAction, onSearch, onQuickAction }: HeroSectionProps =
		$props();
</script>

<section class="hero">
	<div class="hero-content">
		<div class="hero-text">
			{#if userName}
				<p class="greeting">Hello {userName},</p>
			{/if}
			<h1 class="hero-title">What can Charlie help you with?</h1>
			<p class="hero-subtitle">
				Provision and manage your OCI resources with AI-powered assistance
			</p>
		</div>

		<div class="search-container">
			<SearchBox onSubmit={onSearch} />

			<div class="quick-links">
				<span class="quick-label">Quick actions:</span>
				{#each quickActions as action (action.label)}
					<button
						type="button"
						class="quick-link"
						disabled={loadingAction !== null}
						onclick={() => onQuickAction(action.prompt)}
						class:loading={loadingAction === action.prompt}
					>
						{#if loadingAction === action.prompt}
							<LoadingSpinner size="sm" />
						{/if}
						<span class="label-text">{action.label}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="hero-visual">
		<div class="hero-graphic">
			<div class="graphic-ring ring-1"></div>
			<div class="graphic-ring ring-2"></div>
			<div class="graphic-ring ring-3"></div>
			<div class="graphic-center">
				<div class="charlie-hero-mark">C</div>
			</div>
		</div>
	</div>
</section>

<style>
	.hero {
		padding: var(--space-xxl) 2rem;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-xxl);
		max-width: 1400px;
		margin: 0 auto;
		align-items: center;
	}

	.hero-content {
		max-width: 700px;
	}

	.greeting {
		color: var(--accent-primary);
		font-size: var(--text-lg);
		font-weight: 600;
		font-style: italic;
		margin-bottom: var(--space-xs);
	}

	.hero-title {
		font-size: var(--text-hero);
		font-weight: 700;
		color: var(--fg-primary);
		letter-spacing: -0.03em;
		line-height: 1.2;
		margin-bottom: var(--space-sm);
	}

	.hero-subtitle {
		color: var(--fg-tertiary);
		font-size: var(--text-lg);
		margin-bottom: var(--space-xl);
	}

	.search-container {
		width: 100%;
	}

	.quick-links {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-top: var(--space-md);
		flex-wrap: wrap;
	}

	.quick-label {
		color: var(--fg-tertiary);
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.quick-link {
		color: var(--accent-primary);
		font-size: var(--text-xs);
		font-weight: 500;
		text-decoration: none;
		padding: var(--space-xs) var(--space-sm);
		background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all var(--transition-fast);
		font-family: inherit;
	}

	.quick-link:hover {
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
	}

	.quick-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.quick-link.loading {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
	}

	.quick-link.loading .label-text {
		display: none;
	}

	/* Hero Visual */
	.hero-visual {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.hero-graphic {
		position: relative;
		width: 280px;
		height: 280px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.graphic-ring {
		position: absolute;
		border-radius: 50%;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 15%, transparent);
		animation: pulse 4s ease-in-out infinite;
	}

	.ring-1 {
		width: 100%;
		height: 100%;
		animation-delay: 0s;
	}
	.ring-2 {
		width: 75%;
		height: 75%;
		animation-delay: 0.5s;
	}
	.ring-3 {
		width: 50%;
		height: 50%;
		animation-delay: 1s;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.3;
			transform: scale(1);
		}
		50% {
			opacity: 0.6;
			transform: scale(1.02);
		}
	}

	.graphic-center {
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.charlie-hero-mark {
		width: 80px;
		height: 80px;
		border-radius: var(--radius-full);
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		font-size: 2.5rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 0 40px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	@media (max-width: 1024px) {
		.hero {
			grid-template-columns: 1fr;
		}
		.hero-visual {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.hero {
			padding: var(--space-xl) 1rem;
		}
	}
</style>
