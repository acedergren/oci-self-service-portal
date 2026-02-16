<script lang="ts">
	interface SecretInputProps {
		value: string;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		name?: string;
		autocomplete?: HTMLInputElement['autocomplete'];
		onInput: (value: string) => void;
	}

	let {
		value = $bindable(''),
		placeholder = 'Enter secret...',
		disabled = false,
		required = false,
		name,
		autocomplete = 'off',
		onInput = () => {}
	}: SecretInputProps = $props();

	let showSecret = $state(false);

	function toggleVisibility() {
		showSecret = !showSecret;
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = target.value;
		onInput(target.value);
	}
</script>

<div class="secret-input-wrapper">
	<input
		type={showSecret ? 'text' : 'password'}
		{value}
		{placeholder}
		{disabled}
		{required}
		{name}
		{autocomplete}
		oninput={handleInput}
		class="secret-input"
	/>
	<button
		type="button"
		class="secret-toggle"
		onclick={toggleVisibility}
		{disabled}
		aria-label={showSecret ? 'Hide secret' : 'Show secret'}
	>
		{#if showSecret}
			<!-- Eye off icon -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
				<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
				<line x1="1" y1="1" x2="23" y2="23" />
			</svg>
		{:else}
			<!-- Eye icon -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		{/if}
	</button>
</div>

<style>
	.secret-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.secret-input {
		flex: 1;
		padding: var(--space-sm) var(--space-md);
		padding-right: calc(var(--space-md) * 3);
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-family: ui-monospace, monospace;
		font-size: var(--text-sm);
		transition: all var(--transition-fast);
	}

	.secret-input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px oklch(0.78 0.22 45 / 0.2);
	}

	.secret-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.secret-input::placeholder {
		color: var(--fg-tertiary);
	}

	.secret-toggle {
		position: absolute;
		right: var(--space-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-xs);
		background: transparent;
		border: none;
		color: var(--fg-secondary);
		cursor: pointer;
		transition: color var(--transition-fast);
	}

	.secret-toggle:hover:not(:disabled) {
		color: var(--fg-primary);
	}

	.secret-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
