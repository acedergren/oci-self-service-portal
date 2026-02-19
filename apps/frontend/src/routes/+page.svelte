<script lang="ts">
	import { createChatContext } from '$lib/components/chat/ai-context.svelte.js';
	import {
		WORKFLOW_TEMPLATES,
		createPlanFromTemplate,
		type WorkflowTemplate
	} from '@portal/shared/workflows/index';
	import type { AgentPlan } from '$lib/components/panels/types.js';
	import type { ServiceAction } from '$lib/components/portal/types.js';
	import {
		HeroSection,
		ServiceCategoryGrid,
		WorkflowGallery,
		BottomInfoSection,
		ChatOverlay
	} from '$lib/components/portal/index.js';
	import {
		SERVICE_CATEGORIES,
		QUICK_ACTIONS,
		RESOURCE_LINKS,
		FEATURED_WORKFLOW_IDS
	} from '$lib/components/portal/data.js';
	import AdvisorSummaryWidget from '$lib/components/cloud-advisor/AdvisorSummaryWidget.svelte';
	import { createQuery } from '@tanstack/svelte-query';

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

	// ── Recent activity from API ───────────────────────────────────────────
	interface ActivityResponse {
		activities: { id: string; toolName: string; createdAt: string; status: string }[];
	}

	const activityQuery = createQuery<ActivityResponse>(() => ({
		queryKey: ['activity'],
		queryFn: async () => {
			const res = await fetch('/api/activity');
			if (!res.ok) throw new Error('Failed to fetch activity');
			return res.json();
		}
	}));

	const recentActivity = $derived(
		(activityQuery.data?.activities ?? []).map(
			(a: { id: string; toolName: string; createdAt: string; status: string }) => ({
				id: a.id?.slice(0, 8) ?? '—',
				type: a.toolName?.includes('database')
					? 'database'
					: a.toolName?.includes('network') || a.toolName?.includes('vcn')
						? 'networking'
						: 'compute',
				action: a.toolName?.replace(/^oci[_-]/, '').replace(/[_-]/g, ' ') ?? 'Unknown',
				time: getRelativeTime(a.createdAt),
				status: (a.status as 'completed' | 'pending' | 'failed') ?? 'completed'
			})
		)
	);

	function getRelativeTime(dateStr: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

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

	const ctx = createChatContext({ customFetch: modelAwareFetch });
	const { chat } = ctx;

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
	<title>CloudNow</title>
</svelte:head>

<svelte:window onkeydown={handleKeyDown} />

<div class="portal">
	<HeroSection
		quickActions={QUICK_ACTIONS}
		{loadingAction}
		onSearch={sendPrompt}
		onQuickAction={handleQuickAction}
	/>

	<ServiceCategoryGrid categories={SERVICE_CATEGORIES} onAction={handleServiceAction} />

	<WorkflowGallery workflows={featuredWorkflows} onStart={handleStartWorkflow} />

	<section class="advisor-section">
		<AdvisorSummaryWidget />
	</section>

	<BottomInfoSection {recentActivity} resourceLinks={RESOURCE_LINKS} onAskAI={handleQuickAction} />

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
		min-height: 100vh;
		color: var(--fg-primary);
	}

	.advisor-section {
		max-width: 1400px;
		margin: 0 auto;
		padding: 0 2rem var(--space-lg);
	}
</style>
