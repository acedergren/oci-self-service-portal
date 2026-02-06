import { writable } from 'svelte/store';

export const aiDialogOpen = writable(false);
export const currentTab = writable('home');
export const isLoading = writable(false);
