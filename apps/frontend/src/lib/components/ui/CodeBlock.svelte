<script lang="ts">
	interface Props {
		code: string;
		language?: string;
		title?: string;
		showLineNumbers?: boolean;
		maxHeight?: string;
	}

	let { code, language, title, showLineNumbers = true, maxHeight = '300px' }: Props = $props();

	const lines = $derived(code.split('\n'));
	const lineNumberWidth = $derived(String(lines.length).length);
</script>

<div class="code-block overflow-hidden">
	{#if title || language}
		<div class="flex items-center justify-between px-3 py-2 bg-elevated border-b border-muted">
			{#if title}
				<span class="text-primary text-sm">{title}</span>
			{/if}
			{#if language}
				<span class="text-tertiary text-xs">{language}</span>
			{/if}
		</div>
	{/if}

	<div class="overflow-auto" style:max-height={maxHeight}>
		<pre class="p-0 m-0"><code class="block p-3"
				>{#each lines as line, i}<span class="flex"
						><span
							class="text-tertiary select-none pr-3 text-right"
							class:hidden={!showLineNumbers}
							style:width="{lineNumberWidth + 2}ch">{i + 1}</span
						><span class="text-primary flex-1">{line || ' '}</span></span
					>{/each}</code
			></pre>
	</div>
</div>
