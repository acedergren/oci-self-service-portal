<script lang="ts">
	import type { NodePropertiesProps, WorkflowNodeData } from './types.js';
	import type {
		ToolNodeData,
		ConditionNodeData,
		ApprovalNodeData,
		InputNodeData,
		OutputNodeData
	} from '@portal/shared/workflows/types';

	let { selectedNodeId, nodeType, nodeData, onUpdate, onDelete }: NodePropertiesProps = $props();

	// Cast helpers for type-safe access
	const toolData = $derived(nodeType === 'tool' ? (nodeData as ToolNodeData) : null);
	const conditionData = $derived(nodeType === 'condition' ? (nodeData as ConditionNodeData) : null);
	const approvalData = $derived(nodeType === 'approval' ? (nodeData as ApprovalNodeData) : null);
	const inputData = $derived(nodeType === 'input' ? (nodeData as InputNodeData) : null);
	const outputData = $derived(nodeType === 'output' ? (nodeData as OutputNodeData) : null);

	function updateField(field: string, value: unknown) {
		if (!selectedNodeId || !nodeData) return;
		onUpdate(selectedNodeId, { ...nodeData, [field]: value } as WorkflowNodeData);
	}

	function handleDelete() {
		if (selectedNodeId) {
			onDelete(selectedNodeId);
		}
	}

	const nodeTypeLabels: Record<string, string> = {
		tool: 'Tool Node',
		condition: 'Condition Node',
		approval: 'Approval Gate',
		input: 'Input Parameters',
		output: 'Output Mapping',
		loop: 'Loop Node',
		'ai-step': 'AI Step',
		parallel: 'Parallel Node'
	};
</script>

<aside class="node-properties">
	{#if selectedNodeId && nodeType && nodeData}
		<div class="properties-header">
			<h3 class="properties-title">{nodeTypeLabels[nodeType] ?? 'Properties'}</h3>
			<button class="delete-btn" onclick={handleDelete} title="Delete node">
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
					<path
						d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
					/>
				</svg>
			</button>
		</div>

		<div class="properties-body">
			<!-- Tool Node Properties -->
			{#if toolData}
				<div class="field-group">
					<span class="field-label">Tool Name</span>
					<div class="field-value readonly">{toolData.toolName}</div>
				</div>
				{#if toolData.toolCategory}
					<div class="field-group">
						<span class="field-label">Category</span>
						<div class="field-value readonly">{toolData.toolCategory}</div>
					</div>
				{/if}
				{#if toolData.args && Object.keys(toolData.args).length > 0}
					<div class="field-group">
						<span class="field-label">Arguments</span>
						{#each Object.entries(toolData.args) as [key, value] (key)}
							<div class="param-field">
								<span class="param-label">{key}</span>
								<input
									class="param-input"
									type="text"
									value={String(value ?? '')}
									onchange={(e) => {
										const args = { ...toolData.args, [key]: e.currentTarget.value };
										updateField('args', args);
									}}
								/>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Condition Node Properties -->
			{:else if conditionData}
				<div class="field-group">
					<label class="field-label" for="condition-expression">Expression</label>
					<textarea
						id="condition-expression"
						class="field-textarea"
						value={conditionData.expression}
						onchange={(e) => updateField('expression', e.currentTarget.value)}
						placeholder="e.g. steps.step1.output.status === 'RUNNING'"
						rows="3"
					></textarea>
				</div>
				<div class="field-group">
					<label class="field-label" for="condition-true-branch">True Branch (node ID)</label>
					<input
						id="condition-true-branch"
						class="field-input"
						type="text"
						value={conditionData.trueBranch ?? ''}
						onchange={(e) => updateField('trueBranch', e.currentTarget.value || undefined)}
						placeholder="Optional target node"
					/>
				</div>
				<div class="field-group">
					<label class="field-label" for="condition-false-branch">False Branch (node ID)</label>
					<input
						id="condition-false-branch"
						class="field-input"
						type="text"
						value={conditionData.falseBranch ?? ''}
						onchange={(e) => updateField('falseBranch', e.currentTarget.value || undefined)}
						placeholder="Optional target node"
					/>
				</div>

				<!-- Approval Node Properties -->
			{:else if approvalData}
				<div class="field-group">
					<label class="field-label" for="approval-message">Approval Message</label>
					<textarea
						id="approval-message"
						class="field-textarea"
						value={approvalData.message}
						onchange={(e) => updateField('message', e.currentTarget.value)}
						placeholder="Describe what needs approval..."
						rows="3"
					></textarea>
				</div>
				<div class="field-group">
					<label class="field-label" for="approval-approvers">Approvers (comma-separated)</label>
					<input
						id="approval-approvers"
						class="field-input"
						type="text"
						value={(approvalData.approvers ?? []).join(', ')}
						onchange={(e) =>
							updateField(
								'approvers',
								e.currentTarget.value
									.split(',')
									.map((s) => s.trim())
									.filter(Boolean)
							)}
						placeholder="e.g. admin, security-team"
					/>
				</div>
				<div class="field-group">
					<label class="field-label" for="approval-timeout">Timeout (minutes)</label>
					<input
						id="approval-timeout"
						class="field-input"
						type="number"
						min="1"
						value={approvalData.timeoutMinutes ?? ''}
						onchange={(e) =>
							updateField(
								'timeoutMinutes',
								e.currentTarget.value ? Number(e.currentTarget.value) : undefined
							)}
						placeholder="Optional timeout"
					/>
				</div>

				<!-- Input Node Properties -->
			{:else if inputData}
				<div class="field-group">
					<span class="field-label">Input Fields</span>
					{#each inputData.fields as field, idx (idx)}
						<div class="input-field-card">
							<div class="param-field">
								<span class="param-label">Name</span>
								<input
									class="param-input"
									type="text"
									value={field.name}
									onchange={(e) => {
										const fields = [...inputData.fields];
										fields[idx] = { ...fields[idx], name: e.currentTarget.value };
										updateField('fields', fields);
									}}
								/>
							</div>
							<div class="param-field">
								<span class="param-label">Type</span>
								<select
									class="param-input"
									value={field.type}
									onchange={(e) => {
										const fields = [...inputData.fields];
										fields[idx] = { ...fields[idx], type: e.currentTarget.value };
										updateField('fields', fields);
									}}
								>
									<option value="string">String</option>
									<option value="number">Number</option>
									<option value="boolean">Boolean</option>
									<option value="select">Select</option>
								</select>
							</div>
							<label class="checkbox-label">
								<input
									type="checkbox"
									checked={field.required ?? false}
									onchange={(e) => {
										const fields = [...inputData.fields];
										fields[idx] = { ...fields[idx], required: e.currentTarget.checked };
										updateField('fields', fields);
									}}
								/>
								Required
							</label>
						</div>
					{/each}
					<button
						class="add-field-btn"
						onclick={() => {
							const fields = [...inputData.fields, { name: '', type: 'string' }];
							updateField('fields', fields);
						}}
					>
						+ Add Field
					</button>
				</div>

				<!-- Output Node Properties -->
			{:else if outputData}
				<div class="field-group">
					<span class="field-label">Output Mappings</span>
					{#each Object.entries(outputData.outputMapping) as [key, expr] (key)}
						<div class="param-field">
							<span class="param-label">{key}</span>
							<input
								class="param-input"
								type="text"
								value={expr}
								onchange={(e) => {
									const mapping = { ...outputData.outputMapping, [key]: e.currentTarget.value };
									updateField('outputMapping', mapping);
								}}
								placeholder="Expression"
							/>
						</div>
					{/each}
					<button
						class="add-field-btn"
						onclick={() => {
							const name = `output_${Object.keys(outputData.outputMapping).length + 1}`;
							const mapping = { ...outputData.outputMapping, [name]: '' };
							updateField('outputMapping', mapping);
						}}
					>
						+ Add Output
					</button>
				</div>

				<!-- Generic fallback for other node types -->
			{:else}
				<div class="field-group">
					<span class="field-label">Node Data (JSON)</span>
					<pre class="field-json">{JSON.stringify(nodeData, null, 2)}</pre>
				</div>
			{/if}
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-icon">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					width="32"
					height="32"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M8 12h8M12 8v8" />
				</svg>
			</div>
			<p class="empty-text">Select a node to view its properties</p>
			<p class="empty-hint">Click on any node in the canvas to configure it</p>
		</div>
	{/if}
</aside>

<style>
	.node-properties {
		width: 300px;
		background: var(--bg-secondary);
		border-left: 1px solid var(--border-default);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		flex-shrink: 0;
	}

	.properties-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-default);
	}

	.properties-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--fg-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.delete-btn {
		display: flex;
		align-items: center;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--fg-tertiary);
		padding: 4px;
		border-radius: 4px;
		transition: all 0.15s;
	}

	.delete-btn:hover {
		color: var(--semantic-error);
		background: rgba(255, 0, 0, 0.1);
	}

	.properties-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.field-group {
		margin-bottom: 1rem;
	}

	.field-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-secondary);
		margin-bottom: 0.25rem;
	}

	.field-value.readonly {
		font-size: 0.8125rem;
		color: var(--fg-primary);
		padding: 0.375rem 0.5rem;
		background: var(--bg-tertiary);
		border-radius: 4px;
	}

	.field-input,
	.field-textarea {
		width: 100%;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--fg-primary);
		outline: none;
		font-family: inherit;
		box-sizing: border-box;
	}

	.field-input:focus,
	.field-textarea:focus {
		border-color: var(--accent-primary);
	}

	.field-textarea {
		resize: vertical;
		min-height: 60px;
		font-family: monospace;
		font-size: 0.75rem;
	}

	.field-json {
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		font-size: 0.6875rem;
		color: var(--fg-primary);
		font-family: monospace;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
		max-height: 200px;
		overflow-y: auto;
	}

	.param-field {
		margin-bottom: 0.5rem;
	}

	.param-label {
		display: block;
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		margin-bottom: 0.125rem;
		font-family: monospace;
	}

	.param-input {
		width: 100%;
		padding: 0.25rem 0.375rem;
		font-size: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--fg-primary);
		outline: none;
		font-family: inherit;
		box-sizing: border-box;
	}

	.param-input:focus {
		border-color: var(--accent-primary);
	}

	.input-field-card {
		padding: 0.5rem;
		background: var(--bg-tertiary);
		border-radius: 6px;
		margin-bottom: 0.5rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--fg-secondary);
		cursor: pointer;
	}

	.add-field-btn {
		width: 100%;
		padding: 0.375rem;
		background: none;
		border: 1px dashed var(--border-default);
		border-radius: 4px;
		color: var(--fg-tertiary);
		font-size: 0.75rem;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
	}

	.add-field-btn:hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 2rem;
		text-align: center;
	}

	.empty-icon {
		color: var(--fg-tertiary);
		opacity: 0.5;
		margin-bottom: 1rem;
	}

	.empty-text {
		font-size: 0.875rem;
		color: var(--fg-secondary);
		margin-bottom: 0.25rem;
	}

	.empty-hint {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
</style>
