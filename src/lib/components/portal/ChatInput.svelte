<script lang="ts">
  import type { ChatInputProps } from './types.js';

  let {
    disabled = false,
    placeholder = 'Ask a follow-up question...',
    onSubmit,
  }: ChatInputProps = $props();

  function handleSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    const text = input.value.trim();

    if (text) {
      onSubmit(text);
      input.value = '';
    }
  }
</script>

<form class="chat-input" onsubmit={handleSubmit}>
  <input
    type="text"
    {placeholder}
    {disabled}
  />
  <button type="submit" {disabled} aria-label="Send message">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
    </svg>
  </button>
</form>

<style>
  .chat-input {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid #E2E8F0;
  }

  .chat-input input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    font-size: 0.9375rem;
    color: var(--portal-navy, #1E293B);
    outline: none;
    transition: border-color 0.15s ease;
    font-family: inherit;
  }

  .chat-input input:focus {
    border-color: var(--portal-teal, #0D9488);
  }

  .chat-input input::placeholder {
    color: var(--portal-gray, #94A3B8);
  }

  .chat-input button {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--portal-teal, #0D9488), var(--portal-teal-dark, #0F766E));
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .chat-input button:hover:not(:disabled) {
    transform: scale(1.05);
  }

  .chat-input button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-input button svg {
    width: 20px;
    height: 20px;
  }
</style>
