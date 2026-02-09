<script lang="ts">
	import { Badge } from '$lib/components/ui/index.js';
	import type { WorkflowToolbarProps } from './types.js';

	let {
		workflowName,
		workflowStatus,
		isSaving,
		hasUnsavedChanges,
		onNameChange,
		onSave,
		onPublish,
		onRun,
		onShare
	}: WorkflowToolbarProps = $props();

	let isEditingName = $state(false);
	let editValue = $state('');

	function handleNameSubmit() {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== workflowName) {
			onNameChange(trimmed);
		} else {
			editValue = workflowName;
		}
		isEditingName = false;
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			handleNameSubmit();
		} else if (e.key === 'Escape') {
			editValue = workflowName;
			isEditingName = false;
		}
	}

	const statusVariant = $derived(
		workflowStatus === 'published'
			? ('success' as const)
			: workflowStatus === 'archived'
				? ('default' as const)
				: ('info' as const)
	);
</script>

<div class="workflow-toolbar">
	<div class="toolbar-left">
		<a href="/workflows" class="back-link" title="Back to workflows">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				width="18"
				height="18"
			>
				<path d="M19 12H5M12 19l-7-7 7-7" />
			</svg>
		</a>

		{#if isEditingName}
			<input
				class="name-input"
				type="text"
				bind:value={editValue}
				onblur={handleNameSubmit}
				onkeydown={handleNameKeydown}
			/>
		{:else}
			<button
				class="name-display"
				onclick={() => {
					isEditingName = true;
					editValue = workflowName;
				}}
				type="button"
			>
				<span class="name-text">{workflowName}</span>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					width="14"
					height="14"
					class="edit-icon"
				>
					<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
				</svg>
			</button>
		{/if}

		<Badge variant={statusVariant}>{workflowStatus}</Badge>

		{#if hasUnsavedChanges}
			<span class="unsaved-dot" title="Unsaved changes"></span>
		{/if}
	</div>

	<div class="toolbar-right">
		{#if isSaving}
			<span class="saving-text">Saving...</span>
		{/if}

		<button class="toolbar-btn secondary" onclick={onShare} title="Share workflow">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				width="16"
				height="16"
			>
				<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle
					cx="18"
					cy="19"
					r="3"
				/>
				<path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
			</svg>
			Share
		</button>

		<button
			class="toolbar-btn secondary"
			onclick={onSave}
			disabled={!hasUnsavedChanges || isSaving}
		>
			Save
		</button>

		{#if workflowStatus === 'draft'}
			<button class="toolbar-btn primary" onclick={onPublish}> Publish </button>
		{/if}

		<button class="toolbar-btn accent" onclick={onRun} disabled={workflowStatus === 'archived'}>
			<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
				<polygon points="5 3 19 12 5 21 5 3" />
			</svg>
			Run
		</button>
	</div>
</div>

<style>
	.workflow-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-default);
		height: 48px;
		gap: 1rem;
		flex-shrink: 0;
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.back-link {
		display: flex;
		align-items: center;
		color: var(--fg-secondary);
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--fg-primary);
	}

	.name-display {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-family: inherit;
		transition: background 0.15s;
	}

	.name-display:hover {
		background: var(--bg-hover);
	}

	.name-text {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--fg-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 300px;
	}

	.edit-icon {
		color: var(--fg-tertiary);
		opacity: 0;
		transition: opacity 0.15s;
	}

	.name-display:hover .edit-icon {
		opacity: 1;
	}

	.name-input {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--fg-primary);
		background: var(--bg-elevated);
		border: 1px solid var(--accent-primary);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		outline: none;
		font-family: inherit;
		max-width: 300px;
	}

	.unsaved-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--semantic-warning);
		flex-shrink: 0;
	}

	.saving-text {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		background: var(--bg-elevated);
		color: var(--fg-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
		white-space: nowrap;
	}

	.toolbar-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--fg-primary);
	}

	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.toolbar-btn.primary {
		background: var(--accent-primary);
		color: var(--bg-primary);
		border-color: var(--accent-primary);
	}

	.toolbar-btn.primary:hover:not(:disabled) {
		background: var(--accent-secondary);
	}

	.toolbar-btn.accent {
		background: var(--semantic-success);
		color: var(--bg-primary);
		border-color: var(--semantic-success);
	}

	.toolbar-btn.accent:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	/* .toolbar-btn.secondary inherits default .toolbar-btn styles */
</style>
