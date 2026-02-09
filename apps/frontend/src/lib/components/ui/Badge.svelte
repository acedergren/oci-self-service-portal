<script lang="ts">
	import type { Snippet } from 'svelte';

	type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

	interface Props {
		variant?: BadgeVariant;
		children: Snippet;
	}

	let { variant = 'default', children }: Props = $props();

	const variantClasses: Record<BadgeVariant, string> = {
		default: 'badge-default',
		success: 'badge-success',
		warning: 'badge-warning',
		error: 'badge-error',
		info: 'badge-info',
		accent: 'badge-accent'
	};
</script>

<span class="badge {variantClasses[variant]}">
	{@render children()}
</span>
