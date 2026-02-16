<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	interface Props {
		content: string;
		class?: string;
	}

	let { content, class: className = '' }: Props = $props();

	// Configure marked for safe, clean output
	marked.setOptions({
		breaks: true,
		gfm: true
	});

	const rendered = $derived.by(() => {
		if (!content) return '';
		try {
			const raw = marked.parse(content) as string;
			return DOMPurify.sanitize(raw, {
				ADD_TAGS: ['pre', 'code'],
				ADD_ATTR: ['class']
			});
		} catch {
			// Fallback to escaped text if parsing fails
			return DOMPurify.sanitize(content);
		}
	});
</script>

<div class="markdown-content {className}">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: DOMPurify sanitized -->
	{@html rendered}
</div>

<style>
	.markdown-content {
		line-height: 1.6;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	/* Headings */
	.markdown-content :global(h1) {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 1rem 0 0.5rem;
		color: var(--portal-navy, #1e293b);
	}

	.markdown-content :global(h2) {
		font-size: 1.125rem;
		font-weight: 700;
		margin: 1rem 0 0.5rem;
		color: var(--portal-navy, #1e293b);
	}

	.markdown-content :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		margin: 0.75rem 0 0.375rem;
		color: var(--portal-navy, #1e293b);
	}

	/* Paragraphs */
	.markdown-content :global(p) {
		margin: 0 0 0.75rem;
	}

	.markdown-content :global(p:last-child) {
		margin-bottom: 0;
	}

	/* Bold and emphasis */
	.markdown-content :global(strong) {
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
	}

	/* Lists */
	.markdown-content :global(ul),
	.markdown-content :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}

	.markdown-content :global(li) {
		margin-bottom: 0.25rem;
	}

	.markdown-content :global(li > p) {
		margin-bottom: 0.25rem;
	}

	/* Tables */
	.markdown-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.75rem 0;
		font-size: 0.875rem;
	}

	.markdown-content :global(thead) {
		background: var(--portal-light, #f1f5f9);
	}

	.markdown-content :global(th) {
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-weight: 600;
		font-size: 0.8125rem;
		color: var(--portal-navy, #1e293b);
		border-bottom: 2px solid #e2e8f0;
	}

	.markdown-content :global(td) {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
		color: var(--portal-navy-light, #334155);
	}

	.markdown-content :global(tr:last-child td) {
		border-bottom: none;
	}

	.markdown-content :global(tr:hover) {
		background: rgba(13, 148, 136, 0.04);
	}

	/* Code blocks */
	.markdown-content :global(pre) {
		background: #1e293b;
		color: #e2e8f0;
		padding: 1rem;
		border-radius: 8px;
		overflow-x: auto;
		margin: 0.75rem 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.markdown-content :global(pre code) {
		background: transparent;
		padding: 0;
		color: inherit;
		font-size: inherit;
	}

	/* Inline code */
	.markdown-content :global(code) {
		background: var(--portal-light, #f1f5f9);
		color: var(--portal-teal-dark, #0f766e);
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.85em;
	}

	/* Blockquotes (used for tips and warnings) */
	.markdown-content :global(blockquote) {
		border-left: 3px solid var(--portal-teal, #0d9488);
		margin: 0.75rem 0;
		padding: 0.5rem 1rem;
		background: rgba(13, 148, 136, 0.06);
		border-radius: 0 6px 6px 0;
	}

	.markdown-content :global(blockquote p) {
		margin: 0;
	}

	.markdown-content :global(blockquote p + p) {
		margin-top: 0.5rem;
	}

	/* Horizontal rules */
	.markdown-content :global(hr) {
		border: none;
		border-top: 1px solid #e2e8f0;
		margin: 1rem 0;
	}

	/* Links */
	.markdown-content :global(a) {
		color: var(--portal-teal, #0d9488);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown-content :global(a:hover) {
		color: var(--portal-teal-dark, #0f766e);
	}
</style>
