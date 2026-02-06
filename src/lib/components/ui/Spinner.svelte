<script lang="ts">
	type SpinnerVariant = 'dots' | 'pulse' | 'ring';

	interface Props {
		variant?: SpinnerVariant;
		size?: 'sm' | 'md' | 'lg';
		label?: string;
		color?: string;
	}

	let { variant = 'dots', size = 'md', label, color }: Props = $props();

	const sizeClasses = {
		sm: 'text-sm',
		md: 'text-base',
		lg: 'text-lg'
	};

	// Animated dots for the dots variant
	const dots = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	const pulse = ['●', '◐', '○', '◑'];

	let frameIndex = $state(0);
	let interval: ReturnType<typeof setInterval>;

	$effect(() => {
		const frames = variant === 'pulse' ? pulse : dots;
		const speed = variant === 'pulse' ? 200 : 80;

		interval = setInterval(() => {
			frameIndex = (frameIndex + 1) % frames.length;
		}, speed);

		return () => clearInterval(interval);
	});

	const currentFrame = $derived(variant === 'pulse' ? pulse[frameIndex] : dots[frameIndex]);
</script>

<span class="inline-flex items-center gap-2 {sizeClasses[size]}">
	{#if variant === 'ring'}
		<span
			class="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
			class:w-4={size === 'sm'}
			class:h-4={size === 'sm'}
			class:w-5={size === 'md'}
			class:h-5={size === 'md'}
			class:w-6={size === 'lg'}
			class:h-6={size === 'lg'}
			style:color={color || 'var(--agent-thinking)'}
		></span>
	{:else}
		<span style:color={color || 'var(--agent-thinking)'} class="font-mono">
			{currentFrame}
		</span>
	{/if}
	{#if label}
		<span class="text-secondary">{label}</span>
	{/if}
</span>
