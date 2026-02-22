<script lang="ts">
	export interface BucketItem {
		name: string;
		namespace: string;
		compartmentId?: string;
		objectCount?: number;
		totalSizeBytes?: number;
		visibility: 'Public' | 'Private';
		timeCreated?: string;
		storageTier?: 'Standard' | 'Archive' | 'InfrequentAccess';
	}

	interface Props {
		buckets: BucketItem[];
		title?: string;
	}

	let { buckets, title = 'Object Storage Buckets' }: Props = $props();

	function formatSize(bytes?: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const value = bytes / Math.pow(1024, i);
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatCount(count?: number): string {
		if (!count) return '0';
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
		return String(count);
	}

	function tierClass(tier?: string): string {
		switch (tier) {
			case 'Archive':
				return 'tier-archive';
			case 'InfrequentAccess':
				return 'tier-infrequent';
			default:
				return 'tier-standard';
		}
	}
</script>

<div class="bucket-grid-wrapper">
	{#if title}
		<div class="grid-header">
			<h3 class="grid-title">{title}</h3>
			<span class="grid-count">{buckets.length} bucket{buckets.length !== 1 ? 's' : ''}</span>
		</div>
	{/if}

	{#if buckets.length === 0}
		<p class="empty-message">No buckets found.</p>
	{:else}
		<div class="bucket-cards">
			{#each buckets as bucket (bucket.name)}
				<div class="bucket-card">
					<div class="card-top">
						<div class="card-name-row">
							<span class="bucket-icon">
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" />
								</svg>
							</span>
							<span class="bucket-name">{bucket.name}</span>
						</div>
						<div class="card-badges">
							<span class="visibility-badge" class:public={bucket.visibility === 'Public'}>
								{bucket.visibility}
							</span>
							{#if bucket.storageTier}
								<span class="tier-badge {tierClass(bucket.storageTier)}">
									{bucket.storageTier}
								</span>
							{/if}
						</div>
					</div>
					<div class="card-stats">
						<div class="stat">
							<span class="stat-value">{formatCount(bucket.objectCount)}</span>
							<span class="stat-label">Objects</span>
						</div>
						<div class="stat">
							<span class="stat-value">{formatSize(bucket.totalSizeBytes)}</span>
							<span class="stat-label">Size</span>
						</div>
					</div>
					<div class="card-meta">
						<span class="namespace">{bucket.namespace}</span>
						{#if bucket.timeCreated}
							<span class="created">{new Date(bucket.timeCreated).toLocaleDateString()}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.bucket-grid-wrapper {
		background: var(--portal-white, #ffffff);
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		overflow: hidden;
	}

	.grid-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--portal-border, #e2e8f0);
	}

	.grid-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
		margin: 0;
	}

	.grid-count {
		font-size: 0.75rem;
		color: var(--portal-slate, #64748b);
	}

	.empty-message {
		padding: 2rem;
		text-align: center;
		color: var(--portal-slate, #64748b);
		font-size: 0.875rem;
	}

	.bucket-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.bucket-card {
		border: 1px solid var(--portal-border, #e2e8f0);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.bucket-card:hover {
		border-color: var(--portal-teal, #0d9488);
		box-shadow: 0 1px 4px color-mix(in srgb, black 6%, transparent);
	}

	.card-top {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.card-name-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.bucket-icon {
		color: var(--portal-teal, #0d9488);
		flex-shrink: 0;
	}

	.bucket-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--portal-navy, #1e293b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-badges {
		display: flex;
		gap: 0.25rem;
	}

	.visibility-badge {
		padding: 0.0625rem 0.375rem;
		border-radius: 4px;
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		background: var(--portal-muted-bg, #f1f5f9);
		color: var(--portal-slate, #64748b);
	}

	.visibility-badge.public {
		background: var(--portal-warning-bg, #fffbeb);
		color: var(--portal-warning-dark, #d97706);
	}

	.tier-badge {
		padding: 0.0625rem 0.375rem;
		border-radius: 4px;
		font-size: 0.625rem;
		font-weight: 500;
	}

	.tier-badge.tier-standard {
		background: var(--portal-success-bg, #ecfdf5);
		color: var(--portal-success, #059669);
	}

	.tier-badge.tier-archive {
		background: var(--portal-info-bg, #eff6ff);
		color: var(--portal-info, #2563eb);
	}

	.tier-badge.tier-infrequent {
		background: var(--portal-muted-bg, #f1f5f9);
		color: var(--portal-slate, #64748b);
	}

	.card-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding: 0.5rem 0;
		border-top: 1px solid var(--portal-border-light, #f1f5f9);
		border-bottom: 1px solid var(--portal-border-light, #f1f5f9);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.0625rem;
	}

	.stat-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--portal-navy, #1e293b);
	}

	.stat-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--portal-slate, #64748b);
	}

	.card-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.6875rem;
		color: var(--portal-slate, #94a3b8);
	}

	.namespace {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 60%;
	}
</style>
