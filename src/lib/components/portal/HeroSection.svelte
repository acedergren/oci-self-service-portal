<script lang="ts">
  import SearchBox from '$lib/components/ui/SearchBox.svelte';
  import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
  import type { HeroSectionProps } from './types.js';

  let {
    userName,
    quickActions,
    loadingAction,
    onSearch,
    onQuickAction,
  }: HeroSectionProps = $props();
</script>

<section class="hero">
  <div class="hero-content">
    <div class="hero-text">
      {#if userName}
        <p class="greeting">Hello {userName},</p>
      {/if}
      <h1 class="hero-title">Welcome to Cloud Self-Service</h1>
      <p class="hero-subtitle">Provision and manage your OCI resources with AI-powered assistance</p>
    </div>

    <div class="search-container">
      <SearchBox onSubmit={onSearch} />

      <div class="quick-links">
        <span class="quick-label">Quick actions:</span>
        {#each quickActions as action (action.label)}
          <button
            type="button"
            class="quick-link"
            disabled={loadingAction !== null}
            onclick={() => onQuickAction(action.prompt)}
            class:loading={loadingAction === action.prompt}
          >
            {#if loadingAction === action.prompt}
              <LoadingSpinner size="sm" />
            {/if}
            <span class="label-text">{action.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="hero-visual">
    <div class="hero-graphic">
      <div class="graphic-ring ring-1"></div>
      <div class="graphic-ring ring-2"></div>
      <div class="graphic-ring ring-3"></div>
      <div class="graphic-center">
        <svg viewBox="0 0 48 48" fill="none">
          <path d="M24 4L44 14V34L24 44L4 34V14L24 4Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M24 4V44M4 14L44 34M44 14L4 34" stroke="currentColor" stroke-width="1" opacity="0.3"/>
          <circle cx="24" cy="24" r="6" fill="currentColor" opacity="0.2"/>
        </svg>
      </div>
    </div>
  </div>
</section>

<style>
  .hero {
    background: linear-gradient(135deg, var(--portal-white, #FFFFFF) 0%, var(--portal-light, #F1F5F9) 100%);
    padding: 3rem 2rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3rem;
    max-width: 1400px;
    margin: 0 auto;
    align-items: center;
  }

  .hero-content {
    max-width: 700px;
  }

  .greeting {
    color: var(--portal-teal, #0D9488);
    font-size: 1.125rem;
    font-weight: 600;
    font-style: italic;
    margin-bottom: 0.25rem;
  }

  .hero-title {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--portal-navy, #1E293B);
    letter-spacing: -0.03em;
    line-height: 1.2;
    margin-bottom: 0.75rem;
  }

  .hero-subtitle {
    color: var(--portal-slate, #64748B);
    font-size: 1.0625rem;
    margin-bottom: 2rem;
  }

  .search-container {
    width: 100%;
  }

  .quick-links {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .quick-label {
    color: var(--portal-slate, #64748B);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .quick-link {
    color: var(--portal-teal, #0D9488);
    font-size: 0.8125rem;
    font-weight: 500;
    text-decoration: none;
    padding: 0.375rem 0.75rem;
    background: rgba(13, 148, 136, 0.08);
    border: none;
    border-radius: 100px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  .quick-link:hover {
    background: rgba(13, 148, 136, 0.15);
  }

  .quick-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .quick-link.loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(13, 148, 136, 0.2);
  }

  .quick-link.loading .label-text {
    display: none;
  }

  /* Hero Visual */
  .hero-visual {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hero-graphic {
    position: relative;
    width: 280px;
    height: 280px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .graphic-ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(13, 148, 136, 0.15);
    animation: pulse 4s ease-in-out infinite;
  }

  .ring-1 { width: 100%; height: 100%; animation-delay: 0s; }
  .ring-2 { width: 75%; height: 75%; animation-delay: 0.5s; }
  .ring-3 { width: 50%; height: 50%; animation-delay: 1s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.02); }
  }

  .graphic-center {
    width: 80px;
    height: 80px;
    color: var(--portal-teal, #0D9488);
    z-index: 1;
  }

  .graphic-center svg {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    .hero {
      grid-template-columns: 1fr;
    }
    .hero-visual {
      display: none;
    }
  }

  @media (max-width: 768px) {
    .hero {
      padding: 2rem 1rem;
    }
    .hero-title {
      font-size: 1.75rem;
    }
  }
</style>
