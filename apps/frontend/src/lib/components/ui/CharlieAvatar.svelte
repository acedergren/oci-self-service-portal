<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg' | 'xl';
		animate?: boolean;
	}

	let { size = 'md', animate = false }: Props = $props();

	const sizeMap = {
		sm: { dimension: '24px', fontSize: '0.75rem' },
		md: { dimension: '32px', fontSize: '1rem' },
		lg: { dimension: '48px', fontSize: '1.5rem' },
		xl: { dimension: '80px', fontSize: '2.5rem' }
	} as const;

	const config = $derived(sizeMap[size]);
</script>

<div
	class="charlie-avatar"
	class:animate-pulse-glow={animate}
	style:width={config.dimension}
	style:height={config.dimension}
	style:font-size={config.fontSize}
	role="img"
	aria-label="Charlie AI assistant"
>
	C
</div>

<style>
	.charlie-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		font-weight: 700;
		flex-shrink: 0;
		box-shadow: 0 0 20px color-mix(in srgb, var(--accent-primary) 20%, transparent);
	}
</style>
