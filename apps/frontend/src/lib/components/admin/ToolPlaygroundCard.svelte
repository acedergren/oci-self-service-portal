<script lang="ts">
	import type { CachedTool } from '@portal/server/admin/mcp-types';

	interface Props {
		tool: CachedTool;
		onExecute: (args: Record<string, unknown>) => void;
		isPending?: boolean;
	}

	let { tool, onExecute, isPending = false }: Props = $props();

	let isExpanded = $state(false);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic JSON Schema form, values are heterogeneous
	let formArgs = $state<Record<string, any>>({});
	let result = $state<unknown>(null);
	let duration = $state<number | null>(null);

	const schema = $derived(
		tool.inputSchema as {
			properties?: Record<string, Record<string, unknown>>;
			required?: string[];
		}
	);
	const properties = $derived(schema.properties || {});
	const required = $derived(schema.required || []);

	function handleExecute() {
		const startTime = performance.now();
		result = null;
		duration = null;

		// Execute the tool
		onExecute(formArgs);

		// Simulate result capture (in real implementation, this would come from the mutation result)
		const endTime = performance.now();
		duration = Math.round(endTime - startTime);
	}

	function renderInputField(key: string, propSchema: Record<string, unknown>) {
		const type = propSchema.type;

		if (type === 'boolean') {
			return {
				type: 'checkbox' as const,
				defaultValue: false
			};
		} else if (type === 'number' || type === 'integer') {
			return {
				type: 'number' as const,
				defaultValue: 0
			};
		} else if (propSchema.enum) {
			const options = propSchema.enum as string[];
			if (options.length === 0) {
				return {
					type: 'text' as const,
					defaultValue: ''
				};
			}
			return {
				type: 'select' as const,
				options,
				defaultValue: options[0]
			};
		} else if (type === 'object' || type === 'array') {
			return {
				type: 'json',
				defaultValue: type === 'array' ? '[]' : '{}'
			};
		} else {
			return {
				type: 'text',
				defaultValue: ''
			};
		}
	}

	function initializeFormArgs() {
		const args: Record<string, unknown> = {};
		Object.entries(properties).forEach(([key, propSchema]) => {
			const field = renderInputField(key, propSchema);
			args[key] = field.defaultValue;
		});
		formArgs = args;
	}

	$effect(() => {
		if (isExpanded && Object.keys(formArgs).length === 0) {
			initializeFormArgs();
		}
	});
</script>

<div class="tool-card">
	<button
		type="button"
		class="tool-header"
		onclick={() => (isExpanded = !isExpanded)}
		class:expanded={isExpanded}
	>
		<div class="header-left">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
				/>
			</svg>
			<div class="tool-info">
				<h3 class="tool-name">{tool.toolName}</h3>
				<p class="tool-description">{tool.toolDescription}</p>
			</div>
		</div>
		<svg
			class="expand-icon"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	</button>

	{#if isExpanded}
		<div class="tool-body">
			<form
				class="tool-form"
				onsubmit={(e) => {
					e.preventDefault();
					handleExecute();
				}}
			>
				{#if Object.keys(properties).length === 0}
					<p class="no-params">This tool doesn't require any parameters</p>
				{:else}
					{#each Object.entries(properties) as [key, propSchema] (key)}
						{@const field = renderInputField(key, propSchema)}
						{@const isRequired = required.includes(key)}

						<div class="form-group">
							<label for={`${tool.id}-${key}`}>
								{key}
								{#if isRequired}
									<span class="required">*</span>
								{/if}
							</label>

							{#if field.type === 'checkbox'}
								<label class="checkbox-label">
									<input type="checkbox" id={`${tool.id}-${key}`} bind:checked={formArgs[key]} />
									<span>{propSchema.description || 'Enable'}</span>
								</label>
							{:else if field.type === 'select'}
								<select
									id={`${tool.id}-${key}`}
									bind:value={formArgs[key]}
									required={isRequired}
									class="form-input"
								>
									{#each field.options as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							{:else if field.type === 'json'}
								<textarea
									id={`${tool.id}-${key}`}
									bind:value={formArgs[key]}
									required={isRequired}
									rows="4"
									class="form-input"
									placeholder={field.defaultValue}
								></textarea>
							{:else if field.type === 'number'}
								<input
									type="number"
									id={`${tool.id}-${key}`}
									bind:value={formArgs[key]}
									required={isRequired}
									class="form-input"
								/>
							{:else}
								<input
									type="text"
									id={`${tool.id}-${key}`}
									bind:value={formArgs[key]}
									required={isRequired}
									placeholder={String(propSchema.description || '')}
									class="form-input"
								/>
							{/if}

							{#if propSchema.description}
								<p class="form-hint">{propSchema.description}</p>
							{/if}
						</div>
					{/each}
				{/if}

				<button type="submit" class="btn-execute" disabled={isPending}>
					{#if isPending}
						<div class="spinner-small"></div>
						Executing...
					{:else}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<polygon points="5 3 19 12 5 21 5 3" />
						</svg>
						Execute Tool
					{/if}
				</button>
			</form>

			{#if result !== null}
				<div class="result-section">
					<div class="result-header">
						<span class="result-title">Result</span>
						{#if duration !== null}
							<span class="result-duration">{duration}ms</span>
						{/if}
					</div>
					<pre class="result-content"><code>{JSON.stringify(result, null, 2)}</code></pre>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: all var(--transition-fast);
	}

	.tool-card:hover {
		border-color: var(--border-focused);
		box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.1);
	}

	.tool-header {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-md);
		background: var(--bg-elevated);
		border: none;
		cursor: pointer;
		transition: all var(--transition-fast);
		text-align: left;
	}

	.tool-header:hover {
		background: var(--bg-hover);
	}

	.tool-header.expanded {
		border-bottom: 1px solid var(--border-muted);
	}

	.header-left {
		display: flex;
		align-items: start;
		gap: var(--space-sm);
		flex: 1;
		min-width: 0;
	}

	.header-left > svg {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--accent-primary);
	}

	.tool-info {
		flex: 1;
		min-width: 0;
	}

	.tool-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
		margin-bottom: var(--space-xs);
		font-family: 'SF Mono', 'Monaco', monospace;
	}

	.tool-description {
		font-size: var(--text-xs);
		color: var(--fg-secondary);
		line-height: 1.4;
	}

	.expand-icon {
		flex-shrink: 0;
		color: var(--fg-tertiary);
		transition: transform var(--transition-fast);
	}

	.tool-header.expanded .expand-icon {
		transform: rotate(180deg);
	}

	.tool-body {
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.tool-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.no-params {
		padding: var(--space-md);
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		color: var(--fg-tertiary);
		font-size: var(--text-sm);
		text-align: center;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.required {
		color: var(--semantic-error);
	}

	.form-input {
		width: 100%;
		padding: var(--space-sm) var(--space-md);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--fg-primary);
		font-size: var(--text-sm);
		font-family: inherit;
		transition: all var(--transition-fast);
	}

	textarea.form-input {
		font-family: 'SF Mono', 'Monaco', monospace;
		resize: vertical;
	}

	.form-input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		cursor: pointer;
		font-weight: 400;
	}

	.checkbox-label input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.form-hint {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
	}

	.btn-execute {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-lg);
		background: var(--accent-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-execute:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 0 20px -5px var(--accent-primary);
	}

	.btn-execute:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.spinner-small {
		width: 16px;
		height: 16px;
		border: 2px solid var(--bg-primary);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.result-section {
		padding-top: var(--space-md);
		border-top: 1px solid var(--border-muted);
	}

	.result-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-sm);
	}

	.result-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--fg-primary);
	}

	.result-duration {
		font-size: var(--text-xs);
		color: var(--fg-tertiary);
		font-family: 'SF Mono', 'Monaco', monospace;
	}

	.result-content {
		padding: var(--space-md);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.result-content code {
		font-family:
			'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro',
			monospace;
		color: var(--fg-primary);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
