<!-- src/lib/components/mobile/BottomNav.svelte -->
<script lang="ts">
	interface NavItem {
		id: string;
		label: string;
		icon: string;
		badge?: number;
	}

	interface Props {
		items: NavItem[];
		activeId: string;
		onselect: (id: string) => void;
	}

	let { items, activeId, onselect }: Props = $props();
</script>

<nav
	class="fixed bottom-0 left-0 right-0 h-16 bg-secondary border-t border-default safe-bottom lg:hidden z-40"
>
	<div class="flex h-full items-center justify-around px-2">
		{#each items as item (item.id)}
			<button
				class="flex flex-col items-center justify-center touch-target px-3 py-1 rounded-lg transition-fast {activeId ===
				item.id
					? 'text-accent bg-elevated'
					: 'text-secondary hover:text-primary hover:bg-hover'}"
				onclick={() => onselect(item.id)}
			>
				<span class="text-xl">{item.icon}</span>
				<span class="text-xs mt-0.5">{item.label}</span>
				{#if item.badge && item.badge > 0}
					<span
						class="absolute -top-1 -right-1 bg-accent text-primary text-xs rounded-full w-5 h-5 flex items-center justify-center"
					>
						{item.badge > 9 ? '9+' : item.badge}
					</span>
				{/if}
			</button>
		{/each}
	</div>
</nav>
