# Self-Service Portal Structure Analysis

## Current Architecture

### Routes
- `/self-service` → `src/routes/self-service/+page.svelte` (Portal homepage)
- `/` → `src/routes/+page.svelte` (Main chat application - full-page dark theme)
- `/api/chat` → `src/routes/api/chat/+server.ts` (Chat API endpoint)
- `/api/mcp`, `/api/models`, `/api/sessions`, `/api/tools` (Supporting APIs)

### Component Hierarchy

```
src/lib/components/
├── ui/
│   ├── ModelPicker.svelte (currently unused for portal)
│   ├── Spinner.svelte (exists but not used in portal)
│   ├── ApprovalDialog.svelte
│   ├── CodeBlock.svelte
│   ├── Badge.svelte
│   ├── Collapsible.svelte
│   └── index.ts (exports all UI components)
├── panels/
│   ├── ToolPanel.svelte (displays quick action buttons)
│   ├── ThoughtPanel.svelte
│   ├── ReasoningPanel.svelte
│   └── index.ts
└── mobile/
    ├── Drawer.svelte
    ├── BottomNav.svelte
    └── index.ts
```

### Self-Service Portal Page Structure
**File:** `src/routes/self-service/+page.svelte` (42.9 KB)

**Key Components:**
1. Service Categories Display (hardcoded 6 categories: Compute, Database, Networking, Storage, Identity, Monitoring)
2. Quick Actions Panel (4 quick action buttons)
3. Search Box (inline, currently non-functional)
4. AI Assistant Dialog (launches full-page chat when clicked)
5. Navigation Tabs (Home, Services, AI Chat)
6. Conversation History Sidebar

**Data Flow:**
```
User Input (Search/Quick Actions)
    ↓
ModelAwareFetch (injects selected model)
    ↓
/api/chat POST
    ↓
OCI Tools Execution
    ↓
Stream Response Back
```

### API Endpoints

#### `/api/chat` (POST)
- **Input:** `{ messages: UIMessage[], model?: string }`
- **Output:** Streaming text response with tool execution
- **Features:**
  - Model injection via body
  - OCI tool availability
  - System prompt with compartment context
  - Streaming support

**System Prompt Includes:**
- Available tool categories (compute, networking, storage, database, identity, observability)
- Default compartment guidance
- Instructions for tool result summarization

### Data & State Management

**Current State Variables:**
- `selectedModel` - Current LLM model selection
- `searchFocused` - Search input focus state
- `showCommandPalette` - Command palette visibility
- `searchInput` - Search query text

**Missing:**
- Centralized UI state store (e.g., `aiDialogOpen`, `loading` states)
- Persistent conversation state across components
- Error state management

### Component Usage Issues

**ToolPanel Component:**
- Located in `src/lib/components/ui/ToolPanel.svelte`
- Currently used but doesn't show loading states
- No feedback on button clicks
- Disabled state not implemented

**ModelPicker Component:**
- Located in `src/lib/components/ui/ModelPicker.svelte`
- Currently unused in portal
- Could be repurposed for AI dialog theme consistency

### Navigation & Routing

**Portal Navigation Issues:**
1. Services Tab → Does nothing (broken)
2. AI Chat Tab → Navigates to `/` (full-page dark theme app)
3. Home Tab → Stays on `/self-service`

**Problems:**
- Navigation inconsistency (tabs behave differently)
- AI Chat navigation breaks portal context (separate full-page app)
- No tab state persistence
- No visual feedback on navigation

### Theme System

**Current Implementation:**
- Light theme in `/self-service` (white background, teal accents)
- Dark theme in `/` (gray-900 background, light text)
- Theme defined in `src/lib/theme.ts`
- No theme switcher component

**Issue:**
- Clicking "AI Chat" tab navigates to dark theme, breaking UX cohesion

### Search Functionality Analysis

**Current Implementation (Non-Functional):**
- Input field in portal
- Form submission handler exists
- Query sent to `/api/chat`
- **Problem:** Dialog doesn't open after search
- **Problem:** Loading state not shown
- **Problem:** No visual feedback on submission

### Integration Points for Improvements

1. **Store Creation:** `src/lib/stores/ui.ts` needed for dialog/loading state
2. **Component Creation:**
   - `SearchBox.svelte` - Functional search with loading
   - `LoadingSpinner.svelte` - Reusable spinner component
   - `AIDialog.svelte` - Unified modal sidebar for AI chat
3. **Component Modification:**
   - `ToolPanel.svelte` - Add loading states
   - `src/routes/self-service/+page.svelte` - Integrate new components
4. **API Enhancement:**
   - Error response handling in `/api/chat`

## File Dependencies

```
src/routes/self-service/+page.svelte
├── Imports: Chat, DefaultChatTransport, useModels
├── Uses: ToolPanel.svelte
├── Needs: AIDialog.svelte (new), SearchBox.svelte (new)
└── State needed: aiDialogOpen store

src/lib/components/ui/ToolPanel.svelte
├── Uses: Quick action buttons
├── Needs: LoadingSpinner.svelte (new)
└── State needed: loading indicators per action

src/lib/components/ui/ModelPicker.svelte
└── Could be: Repurposed or renamed to AIDialog
```

## Success Criteria for Improvements

- ✅ Functional search box with loading feedback
- ✅ Unified AI dialog as modal/sidebar (not full-page)
- ✅ No broken navigation tabs
- ✅ Theme consistency throughout portal
- ✅ Loading states on all operations
- ✅ Error handling with user messages
- ✅ All components tested

## Next Phase
Ready to implement Task 2: Debug & Fix Main Search Box
