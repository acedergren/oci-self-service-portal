// Portal component barrel exports

// Top-level components
export { default as PortalHeader } from './PortalHeader.svelte';
export { default as HeroSection } from './HeroSection.svelte';
export { default as ServiceCategoryGrid } from './ServiceCategoryGrid.svelte';
export { default as WorkflowGallery } from './WorkflowGallery.svelte';
export { default as BottomInfoSection } from './BottomInfoSection.svelte';
export { default as ChatOverlay } from './ChatOverlay.svelte';

// Child/internal components
export { default as QuickActionBar } from './QuickActionBar.svelte';
export { default as ServiceCategoryCard } from './ServiceCategoryCard.svelte';
export { default as WorkflowCard } from './WorkflowCard.svelte';
export { default as RecentActivityPanel } from './RecentActivityPanel.svelte';
export { default as ResourceLinksPanel } from './ResourceLinksPanel.svelte';
export { default as HelpPanel } from './HelpPanel.svelte';

// Chat sub-components
export { default as ChatMessageList } from './ChatMessageList.svelte';
export { default as ChatMessage } from './ChatMessage.svelte';
export { default as ChatInput } from './ChatInput.svelte';
export { default as ToolCallCard } from './ToolCallCard.svelte';
export { default as TypingIndicator } from './TypingIndicator.svelte';

// Types
export type {
	// Shared types
	ServiceColor,
	ServiceIconId,
	ServiceAction,
	ServiceCategory,
	QuickAction,
	ActivityItem,
	ResourceLink,
	ServiceIconMap,

	// Component props
	PortalHeaderProps,
	HeroSectionProps,
	QuickActionBarProps,
	ServiceCategoryGridProps,
	ServiceCategoryCardProps,
	WorkflowGalleryProps,
	WorkflowCardProps,
	BottomInfoSectionProps,
	RecentActivityPanelProps,
	ResourceLinksPanelProps,
	HelpPanelProps,
	ChatOverlayProps,
	ChatMessageListProps,
	ChatMessageProps,
	ChatToolPart,
	ToolCallCardProps,
	ChatInputProps
} from './types.js';
