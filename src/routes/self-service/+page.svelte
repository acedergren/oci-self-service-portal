<script lang="ts">
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import { useModels } from '$lib/query/hooks.js';
	import {
		WORKFLOW_TEMPLATES,
		createPlanFromTemplate,
		type WorkflowTemplate
	} from '$lib/workflows/index.js';
	import type { AgentPlan } from '$lib/components/panels/types.js';
	import type { ServiceAction } from '$lib/components/portal/types.js';
	import {
		PortalHeader,
		HeroSection,
		ServiceCategoryGrid,
		WorkflowGallery,
		BottomInfoSection,
		ChatOverlay
	} from '$lib/components/portal/index.js';
	import {
		SERVICE_CATEGORIES,
		QUICK_ACTIONS,
		MOCK_RECENT_ACTIVITY,
		RESOURCE_LINKS,
		FEATURED_WORKFLOW_IDS
	} from '$lib/components/portal/data.js';

	// ── Models ──────────────────────────────────────────────────────────────
	const modelsQuery = useModels();
	const availableModels = $derived(modelsQuery.data?.models ?? []);

	// ── Chat state ──────────────────────────────────────────────────────────
	let selectedModel = $state('meta.llama-3.3-70b-instruct');
	let showCommandPalette = $state(false);
	let loadingAction = $state<string | null>(null);
	let hideToolExecution = $state(true);

	// ── Workflow state ──────────────────────────────────────────────────────
	let activeWorkflowPlan = $state<AgentPlan | undefined>(undefined);
	let workflowPanelOpen = $state(true);

	// ── Featured workflows (top 4) ─────────────────────────────────────────
	const featuredWorkflows = WORKFLOW_TEMPLATES.filter((w) =>
		(FEATURED_WORKFLOW_IDS as readonly string[]).includes(w.id)
	);

	// ── Custom fetch with model injection ──────────────────────────────────
	const modelAwareFetch: typeof fetch = async (input, init) => {
		if (init?.body && typeof init.body === 'string') {
			try {
				const body = JSON.parse(init.body);
				body.model = selectedModel;
				init = { ...init, body: JSON.stringify(body) };
			} catch {
				/* Not JSON, pass through */
			}
		}
		return fetch(input, init);
	};

	const chat = new Chat({
		transport: new DefaultChatTransport({
			api: '/api/chat',
			fetch: modelAwareFetch
		})
	});

	// ── Event handlers ──────────────────────────────────────────────────────
	function sendPrompt(prompt: string) {
		showCommandPalette = true;
		chat.sendMessage({ text: prompt });
	}

	function handleQuickAction(prompt: string) {
		loadingAction = prompt;
		sendPrompt(prompt);
		setTimeout(() => {
			loadingAction = null;
		}, 300);
	}

	function handleServiceAction(action: ServiceAction) {
		handleQuickAction(action.prompt);
	}

	function handleStartWorkflow(template: WorkflowTemplate) {
		activeWorkflowPlan = createPlanFromTemplate(template);
		sendPrompt(`Help me ${template.name.toLowerCase()}. ${template.description}`);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
			e.preventDefault();
			hideToolExecution = !hideToolExecution;
		}
	}
</script>

<svelte:head>
	<title>Cloud Self-Service Portal | OCI</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="portal" onkeydown={handleKeyDown}>
	<PortalHeader
		{selectedModel}
		{availableModels}
		onModelChange={(id) => {
			selectedModel = id;
		}}
	/>

	<HeroSection
		userName="Alex"
		quickActions={QUICK_ACTIONS}
		{loadingAction}
		onSearch={sendPrompt}
		onQuickAction={handleQuickAction}
	/>

	<ServiceCategoryGrid categories={SERVICE_CATEGORIES} onAction={handleServiceAction} />

	<WorkflowGallery workflows={featuredWorkflows} onStart={handleStartWorkflow} />

	<BottomInfoSection
		recentActivity={MOCK_RECENT_ACTIVITY}
		resourceLinks={RESOURCE_LINKS}
		onAskAI={handleQuickAction}
	/>

	<ChatOverlay
		open={showCommandPalette}
		{chat}
		{activeWorkflowPlan}
		{workflowPanelOpen}
		{hideToolExecution}
		onClose={() => {
			showCommandPalette = false;
		}}
		onToggleWorkflowPanel={() => {
			workflowPanelOpen = !workflowPanelOpen;
		}}
	/>
</div>

<style>
	.portal {
		--portal-teal: #0d9488;
		--portal-teal-dark: #0f766e;
		--portal-teal-light: #14b8a6;
		--portal-navy: #1e293b;
		--portal-navy-light: #334155;
		--portal-slate: #64748b;
		--portal-gray: #94a3b8;
		--portal-light: #f1f5f9;
		--portal-white: #ffffff;
		--portal-bg: #f8fafc;
		--portal-success: #10b981;
		--portal-warning: #f59e0b;
		--portal-error: #ef4444;

		font-family:
			'Plus Jakarta Sans',
			-apple-system,
			BlinkMacSystemFont,
			sans-serif;
		background: var(--portal-bg);
		min-height: 100vh;
		color: var(--portal-navy);
	}
</style>
