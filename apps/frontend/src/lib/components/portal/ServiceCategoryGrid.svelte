<script lang="ts">
	import ServiceCategoryCard from './ServiceCategoryCard.svelte';
	import type { ServiceCategoryGridProps } from './types.js';

	let { categories, onAction }: ServiceCategoryGridProps = $props();
</script>

<section class="services">
	<div class="services-grid">
		{#each categories as category (category.id)}
			<ServiceCategoryCard {category} {onAction} />
		{/each}
	</div>
</section>

<style>
	.services {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}

	.services-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
	}

	@media (max-width: 1024px) {
		.services-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.services {
			padding: 1rem;
		}
		.services-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
