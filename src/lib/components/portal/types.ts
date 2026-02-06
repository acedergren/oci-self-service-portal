/**
 * Portal Component Types
 *
 * TypeScript interfaces for the Phase 5 self-service portal decomposition.
 * All portal components live under src/lib/components/portal/.
 *
 * Architecture:
 *   +page.svelte (orchestrator, ~120 lines)
 *   +-- PortalHeader
 *   +-- HeroSection
 *   |   +-- SearchBox (existing, reused from ui/)
 *   |   +-- QuickActionBar
 *   |   +-- HeroGraphic
 *   +-- ServiceCategoryGrid
 *   |   +-- ServiceCategoryCard
 *   +-- WorkflowGallery
 *   |   +-- WorkflowCard
 *   +-- BottomInfoSection
 *   |   +-- RecentActivityPanel
 *   |   +-- ResourceLinksPanel
 *   |   +-- HelpPanel
 *   +-- ChatOverlay
 *       +-- ChatMessageList
 *       |   +-- ChatMessage
 *       |   +-- ToolCallCard
 *       |   +-- TypingIndicator
 *       +-- ChatInput
 *       +-- AgentWorkflowPanel (existing, reused from panels/)
 */

import type { Chat } from '@ai-sdk/svelte';
import type { AgentPlan } from '$lib/components/panels/types.js';
import type { WorkflowTemplate } from '$lib/workflows/index.js';

// ---------------------------------------------------------------------------
// Shared / Common
// ---------------------------------------------------------------------------

/** Color tokens used by service categories */
export type ServiceColor = 'teal' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet';

/** Icon identifiers for service categories (mapped to SVG paths) */
export type ServiceIconId = 'server' | 'database' | 'network' | 'storage' | 'shield' | 'chart';

/** A single action within a service category */
export interface ServiceAction {
  label: string;
  prompt: string;
}

/** A service category for the portal grid */
export interface ServiceCategory {
  id: string;
  title: string;
  description: string;
  icon: ServiceIconId;
  color: ServiceColor;
  actions: ServiceAction[];
}

/** A quick action pill (hero section) */
export interface QuickAction {
  label: string;
  prompt: string;
}

/** A recent activity item */
export interface ActivityItem {
  id: string;
  type: string;
  action: string;
  time: string;
  status: 'completed' | 'pending' | 'failed';
}

/** An external resource link */
export interface ResourceLink {
  label: string;
  href: string;
}

// ---------------------------------------------------------------------------
// PortalHeader
// Used by: src/lib/components/portal/PortalHeader.svelte
// ---------------------------------------------------------------------------

export interface PortalHeaderProps {
  /** Currently selected model ID */
  selectedModel: string;
  /** Available models from the API */
  availableModels: Array<{ id: string; name: string; description: string }>;
  /** Notification count badge */
  notificationCount?: number;
  /** Callback when model is changed */
  onModelChange?: (modelId: string) => void;
}

// ---------------------------------------------------------------------------
// HeroSection
// Used by: src/lib/components/portal/HeroSection.svelte
// Contains: SearchBox (reused), QuickActionBar, HeroGraphic
// ---------------------------------------------------------------------------

export interface HeroSectionProps {
  /** User's display name for greeting */
  userName?: string;
  /** Quick action definitions */
  quickActions: QuickAction[];
  /** Whether a loading action is in progress (prompt string or null) */
  loadingAction: string | null;
  /** Callback when a search query is submitted */
  onSearch: (query: string) => void;
  /** Callback when a quick action is clicked */
  onQuickAction: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// QuickActionBar
// Used by: HeroSection (child)
// ---------------------------------------------------------------------------

export interface QuickActionBarProps {
  actions: QuickAction[];
  loadingAction: string | null;
  onAction: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// ServiceCategoryGrid
// Used by: src/lib/components/portal/ServiceCategoryGrid.svelte
// Contains: ServiceCategoryCard
// ---------------------------------------------------------------------------

export interface ServiceCategoryGridProps {
  categories: ServiceCategory[];
  onAction: (action: ServiceAction) => void;
}

// ---------------------------------------------------------------------------
// ServiceCategoryCard
// Used by: ServiceCategoryGrid (child)
// ---------------------------------------------------------------------------

export interface ServiceCategoryCardProps {
  category: ServiceCategory;
  onAction: (action: ServiceAction) => void;
}

// ---------------------------------------------------------------------------
// WorkflowGallery
// Used by: src/lib/components/portal/WorkflowGallery.svelte
// Contains: WorkflowCard
// ---------------------------------------------------------------------------

export interface WorkflowGalleryProps {
  workflows: WorkflowTemplate[];
  onStart: (template: WorkflowTemplate) => void;
}

// ---------------------------------------------------------------------------
// WorkflowCard
// Used by: WorkflowGallery (child)
// ---------------------------------------------------------------------------

export interface WorkflowCardProps {
  workflow: WorkflowTemplate;
  onStart: (template: WorkflowTemplate) => void;
}

// ---------------------------------------------------------------------------
// BottomInfoSection
// Used by: src/lib/components/portal/BottomInfoSection.svelte
// Contains: RecentActivityPanel, ResourceLinksPanel, HelpPanel
// ---------------------------------------------------------------------------

export interface BottomInfoSectionProps {
  recentActivity: ActivityItem[];
  resourceLinks: ResourceLink[];
  onAskAI: (prompt: string) => void;
  onViewAllActivity?: () => void;
}

// ---------------------------------------------------------------------------
// RecentActivityPanel
// Used by: BottomInfoSection (child)
// ---------------------------------------------------------------------------

export interface RecentActivityPanelProps {
  items: ActivityItem[];
  onViewAll?: () => void;
}

// ---------------------------------------------------------------------------
// ResourceLinksPanel
// Used by: BottomInfoSection (child)
// ---------------------------------------------------------------------------

export interface ResourceLinksPanelProps {
  links: ResourceLink[];
}

// ---------------------------------------------------------------------------
// HelpPanel
// Used by: BottomInfoSection (child)
// ---------------------------------------------------------------------------

export interface HelpPanelProps {
  onAskAI: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// ChatOverlay
// Used by: src/lib/components/portal/ChatOverlay.svelte
// Contains: ChatMessageList, ChatInput, AgentWorkflowPanel (reused)
// ---------------------------------------------------------------------------

export interface ChatOverlayProps {
  /** Whether the overlay is visible */
  open: boolean;
  /** The AI SDK Chat instance — state owned by page */
  chat: Chat;
  /** Active workflow plan (if any) */
  activeWorkflowPlan?: AgentPlan;
  /** Whether the workflow panel is expanded */
  workflowPanelOpen?: boolean;
  /** Whether tool execution UI is hidden (show only results) */
  hideToolExecution?: boolean;
  /** Callback to close the overlay */
  onClose: () => void;
  /** Callback to toggle the workflow panel */
  onToggleWorkflowPanel?: () => void;
}

// ---------------------------------------------------------------------------
// ChatMessageList
// Used by: ChatOverlay (child)
// ---------------------------------------------------------------------------

/** A single tool part extracted from a message */
export interface ChatToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  title?: string;
}

export interface ChatMessageListProps {
  messages: Chat['messages'];
  chatStatus: Chat['status'];
  hideToolExecution?: boolean;
}

// ---------------------------------------------------------------------------
// ChatMessage
// Used by: ChatMessageList (child)
// ---------------------------------------------------------------------------

export interface ChatMessageProps {
  message: Chat['messages'][number];
  isLastMessage: boolean;
  isStreaming: boolean;
  hideToolExecution?: boolean;
}

// ---------------------------------------------------------------------------
// ToolCallCard
// Used by: ChatMessage (child)
// ---------------------------------------------------------------------------

export interface ToolCallCardProps {
  part: ChatToolPart;
  hideToolExecution?: boolean;
}

// ---------------------------------------------------------------------------
// TypingIndicator
// Used by: ChatMessage / ChatMessageList (child)
// ---------------------------------------------------------------------------

// No props needed; pure presentational component

// ---------------------------------------------------------------------------
// ChatInput
// Used by: ChatOverlay (child)
// ---------------------------------------------------------------------------

export interface ChatInputProps {
  /** Disable input while streaming */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Callback when a message is submitted */
  onSubmit: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Icon utility (shared across portal components)
// ---------------------------------------------------------------------------

/** Map of service icon IDs to SVG path data */
export type ServiceIconMap = Record<ServiceIconId, string>;
