<script lang="ts">
	interface Model {
		id: string;
		name: string;
		description: string;
	}

	interface Props {
		isOpen?: boolean;
		currentModel?: string;
		models?: Model[];
		region?: string;
		onselect?: (modelId: string) => void;
		onclose?: () => void;
	}

	let {
		isOpen = false,
		currentModel = 'meta.llama-3.3-70b-instruct',
		models: propModels,
		region = 'unknown',
		onselect,
		onclose
	}: Props = $props();

	// Use provided models or fallback to defaults
	const defaultModels: Model[] = [
		// Google Gemini models
		{
			id: 'google.gemini-2.5-pro',
			name: 'Gemini 2.5 Pro',
			description: 'Most capable Gemini model'
		},
		{
			id: 'google.gemini-2.5-flash',
			name: 'Gemini 2.5 Flash',
			description: 'Fast and efficient Gemini'
		},
		{
			id: 'google.gemini-2.5-flash-lite',
			name: 'Gemini 2.5 Flash-Lite',
			description: 'Lightweight Gemini for cost efficiency'
		},
		// Meta Llama 4 models
		{
			id: 'meta.llama-4-maverick',
			name: 'Llama 4 Maverick',
			description: 'Flagship Llama 4 (17B active / 400B total)'
		},
		{
			id: 'meta.llama-4-scout',
			name: 'Llama 4 Scout',
			description: 'Efficient Llama 4 (17B active / 109B total)'
		},
		// Meta Llama 3.x models
		{
			id: 'meta.llama-3.3-70b-instruct',
			name: 'Llama 3.3 70B',
			description: 'Fast, capable general-purpose model'
		},
		{
			id: 'meta.llama-3.2-90b-vision-instruct',
			name: 'Llama 3.2 90B Vision',
			description: 'Multimodal with image understanding'
		},
		{
			id: 'meta.llama-3.2-11b-vision-instruct',
			name: 'Llama 3.2 11B Vision',
			description: 'Lightweight multimodal model'
		},
		{
			id: 'meta.llama-3.1-405b-instruct',
			name: 'Llama 3.1 405B',
			description: 'Most capable Llama 3, best quality'
		},
		// Cohere models
		{
			id: 'cohere.command-a-03-2025',
			name: 'Command A',
			description: 'Latest Cohere with tool use, 256K context'
		},
		{
			id: 'cohere.command-a-reasoning',
			name: 'Command A Reasoning',
			description: 'Optimized for complex reasoning tasks'
		},
		{
			id: 'cohere.command-a-vision',
			name: 'Command A Vision',
			description: 'Multimodal Command with vision'
		},
		{
			id: 'cohere.command-r-plus-08-2024',
			name: 'Command R+ (08-2024)',
			description: 'Advanced RAG optimization'
		},
		{
			id: 'cohere.command-r-08-2024',
			name: 'Command R (08-2024)',
			description: 'Fast and efficient'
		},
		// xAI Grok models
		{
			id: 'xai.grok-4',
			name: 'Grok 4',
			description: 'Latest flagship Grok model'
		},
		{
			id: 'xai.grok-4-fast',
			name: 'Grok 4 Fast',
			description: 'Optimized Grok 4 for speed'
		},
		{
			id: 'xai.grok-4.1-fast',
			name: 'Grok 4.1 Fast',
			description: 'Updated fast Grok model'
		},
		{
			id: 'xai.grok-3',
			name: 'Grok 3',
			description: 'Capable reasoning model'
		},
		{
			id: 'xai.grok-3-mini',
			name: 'Grok 3 Mini',
			description: 'Efficient smaller Grok'
		},
		{
			id: 'xai.grok-code-fast-1',
			name: 'Grok Code Fast',
			description: 'Optimized for code generation'
		}
	];

	const models = $derived(propModels && propModels.length > 0 ? propModels : defaultModels);

	let selectedIndex = $state(0);

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) return;

		switch (event.key) {
			case 'ArrowUp':
				event.preventDefault();
				selectedIndex = Math.max(0, selectedIndex - 1);
				break;
			case 'ArrowDown':
				event.preventDefault();
				selectedIndex = Math.min(models.length - 1, selectedIndex + 1);
				break;
			case 'Enter':
				event.preventDefault();
				onselect?.(models[selectedIndex].id);
				onclose?.();
				break;
			case 'Escape':
				event.preventDefault();
				onclose?.();
				break;
		}
	}

	function handleSelect(modelId: string) {
		onselect?.(modelId);
		onclose?.();
	}

	let dialogRef = $state<HTMLDivElement | undefined>(undefined);

	// Reset selection and focus when opened
	$effect(() => {
		if (isOpen) {
			selectedIndex = models.findIndex((m) => m.id === currentModel);
			if (selectedIndex === -1) selectedIndex = 0;
			// Focus the dialog after it renders
			setTimeout(() => dialogRef?.focus(), 0);
		}
	});
</script>

{#if isOpen}
	<!-- Backdrop -->
	<button
		class="fixed inset-0 bg-black/50 z-40"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose?.()}
		aria-label="Close model picker"
	></button>

	<!-- Modal -->
	<div
		bind:this={dialogRef}
		class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-96 bg-secondary border border-default rounded-lg shadow-xl animate-slide-in-up outline-none"
		role="dialog"
		aria-modal="true"
		aria-label="Select model"
		tabindex="-1"
		onkeydown={handleKeydown}
	>
		<div class="p-4 border-b border-muted">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-primary">Select Model</h2>
				<span class="text-xs text-tertiary font-mono">{region}</span>
			</div>
			<p class="text-sm text-tertiary mt-1">Use arrow keys and Enter, or click to select</p>
		</div>

		<div class="p-2 max-h-80 overflow-y-auto">
			{#each models as model, index (model.id)}
				<button
					class="w-full text-left p-3 rounded-lg transition-fast {index === selectedIndex
						? 'bg-elevated border border-focused'
						: 'hover:bg-hover border border-transparent'}"
					onclick={() => handleSelect(model.id)}
				>
					<div class="flex items-center justify-between">
						<span class="font-medium text-primary">{model.name}</span>
						{#if model.id === currentModel}
							<span class="text-accent text-sm">current</span>
						{/if}
					</div>
					<p class="text-sm text-secondary mt-1">{model.description}</p>
					<p class="text-xs text-tertiary mt-1 font-mono">{model.id}</p>
				</button>
			{/each}
		</div>

		<div class="p-3 border-t border-muted text-xs text-tertiary flex justify-between">
			<span>[↑↓] navigate</span>
			<span>[Enter] select</span>
			<span>[Esc] close</span>
		</div>
	</div>
{/if}
