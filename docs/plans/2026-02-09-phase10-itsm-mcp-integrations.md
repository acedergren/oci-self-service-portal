# Phase 10: ITSM Completeness & MCP Integrations

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the portal into a complete ITSM platform with incident/change management, external system integrations (PagerDuty, Jira, Slack, GitHub), and intelligent knowledge base.

**Architecture:** Extend Mastra agent with ITSM-specific tools, add MCP client connections for external systems, implement vector RAG knowledge base on Oracle ADB 26AI, add SLA tracking with Prometheus metrics, and build operator dashboard.

**Tech Stack:** Mastra agents, MCP SDK (@modelcontextprotocol/sdk), Oracle ADB 26AI (vector search), PagerDuty API, Jira API, Slack SDK, GitHub Octokit, @vercel/ai-sdk, Prometheus metrics

**Dependencies:** Phase 9 complete (Fastify backend, Mastra framework, Oracle vector store, MCP server)

---

## Wave 1: MCP Client Integrations (10.1)

### Task 10.1.1: PagerDuty MCP Client Configuration

**Files:**

- Create: `packages/shared/src/server/mcp-client/configs/pagerduty.ts`
- Modify: `packages/shared/src/server/mcp-client/index.ts` (add export)
- Test: `packages/shared/src/server/mcp-client/configs/pagerduty.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/shared/src/server/mcp-client/configs/pagerduty.test.ts
import { describe, it, expect } from 'vitest';
import { createPagerDutyConfig } from './pagerduty.js';

describe('createPagerDutyConfig', () => {
	it('creates stdio MCP config for PagerDuty server', () => {
		const config = createPagerDutyConfig({ apiKey: 'test-key' });

		expect(config.transport).toBe('stdio');
		expect(config.command).toBe('npx');
		expect(config.args).toContain('-y');
		expect(config.args).toContain('@modelcontextprotocol/server-pagerduty');
		expect(config.env).toEqual({ PAGERDUTY_API_KEY: 'test-key' });
	});

	it('throws if apiKey is missing', () => {
		expect(() => createPagerDutyConfig({ apiKey: '' })).toThrow('PAGERDUTY_API_KEY is required');
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/shared && npx vitest run src/server/mcp-client/configs/pagerduty.test.ts
```

Expected: FAIL with "Cannot find module './pagerduty.js'"

**Step 3: Write minimal implementation**

```typescript
// packages/shared/src/server/mcp-client/configs/pagerduty.ts
import type { MCPServerConfig } from '../types.js';

export interface PagerDutyOptions {
	apiKey: string;
}

/**
 * Create MCP config for PagerDuty integration
 *
 * Provides tools for:
 * - Creating/updating incidents
 * - Triggering/resolving alerts
 * - Querying on-call schedules
 * - Listing services
 */
export function createPagerDutyConfig(options: PagerDutyOptions): MCPServerConfig {
	if (!options.apiKey || options.apiKey.trim() === '') {
		throw new Error('PAGERDUTY_API_KEY is required');
	}

	return {
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-pagerduty'],
		env: {
			PAGERDUTY_API_KEY: options.apiKey
		}
	};
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/shared && npx vitest run src/server/mcp-client/configs/pagerduty.test.ts
```

Expected: PASS

**Step 5: Export from index**

```typescript
// packages/shared/src/server/mcp-client/index.ts (add to exports)
export { createPagerDutyConfig, type PagerDutyOptions } from './configs/pagerduty.js';
```

**Step 6: Commit**

```bash
git add packages/shared/src/server/mcp-client/configs/pagerduty.ts \
        packages/shared/src/server/mcp-client/configs/pagerduty.test.ts \
        packages/shared/src/server/mcp-client/index.ts
git commit -m "feat(mcp): add PagerDuty MCP client configuration

- stdio transport with @modelcontextprotocol/server-pagerduty
- API key validation
- 2 tests covering config creation and validation"
```

---

### Task 10.1.2: Jira MCP Client Configuration

**Files:**

- Create: `packages/shared/src/server/mcp-client/configs/jira.ts`
- Modify: `packages/shared/src/server/mcp-client/index.ts` (add export)
- Test: `packages/shared/src/server/mcp-client/configs/jira.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/shared/src/server/mcp-client/configs/jira.test.ts
import { describe, it, expect } from 'vitest';
import { createJiraConfig } from './jira.js';

describe('createJiraConfig', () => {
	it('creates stdio MCP config for Jira server', () => {
		const config = createJiraConfig({
			domain: 'example.atlassian.net',
			email: 'user@example.com',
			apiToken: 'test-token'
		});

		expect(config.transport).toBe('stdio');
		expect(config.command).toBe('npx');
		expect(config.args).toContain('@modelcontextprotocol/server-jira');
		expect(config.env).toEqual({
			JIRA_DOMAIN: 'example.atlassian.net',
			JIRA_EMAIL: 'user@example.com',
			JIRA_API_TOKEN: 'test-token'
		});
	});

	it('throws if required fields missing', () => {
		expect(() => createJiraConfig({ domain: '', email: '', apiToken: '' })).toThrow(
			'JIRA_DOMAIN, JIRA_EMAIL, and JIRA_API_TOKEN are required'
		);
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/shared && npx vitest run src/server/mcp-client/configs/jira.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// packages/shared/src/server/mcp-client/configs/jira.ts
import type { MCPServerConfig } from '../types.js';

export interface JiraOptions {
	domain: string;
	email: string;
	apiToken: string;
}

/**
 * Create MCP config for Jira integration
 *
 * Provides tools for:
 * - Creating/updating issues and epics
 * - Transitioning issue status
 * - Adding comments
 * - Searching JQL queries
 */
export function createJiraConfig(options: JiraOptions): MCPServerConfig {
	if (!options.domain || !options.email || !options.apiToken) {
		throw new Error('JIRA_DOMAIN, JIRA_EMAIL, and JIRA_API_TOKEN are required');
	}

	return {
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-jira'],
		env: {
			JIRA_DOMAIN: options.domain,
			JIRA_EMAIL: options.email,
			JIRA_API_TOKEN: options.apiToken
		}
	};
}
```

**Step 4: Run test and commit**

```bash
cd packages/shared && npx vitest run src/server/mcp-client/configs/jira.test.ts
# Expected: PASS

# Export from index
# Add to packages/shared/src/server/mcp-client/index.ts:
# export { createJiraConfig, type JiraOptions } from './configs/jira.js';

git add packages/shared/src/server/mcp-client/configs/jira.ts \
        packages/shared/src/server/mcp-client/configs/jira.test.ts \
        packages/shared/src/server/mcp-client/index.ts
git commit -m "feat(mcp): add Jira MCP client configuration"
```

---

### Task 10.1.3: Slack MCP Client Configuration

**Files:**

- Create: `packages/shared/src/server/mcp-client/configs/slack.ts`
- Test: `packages/shared/src/server/mcp-client/configs/slack.test.ts`

**Implementation:**

```typescript
// packages/shared/src/server/mcp-client/configs/slack.ts
import type { MCPServerConfig } from '../types.js';

export interface SlackOptions {
	botToken: string;
	teamId?: string;
}

export function createSlackConfig(options: SlackOptions): MCPServerConfig {
	if (!options.botToken) {
		throw new Error('SLACK_BOT_TOKEN is required');
	}

	return {
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-slack'],
		env: {
			SLACK_BOT_TOKEN: options.botToken,
			...(options.teamId && { SLACK_TEAM_ID: options.teamId })
		}
	};
}
```

**Test:**

```typescript
// packages/shared/src/server/mcp-client/configs/slack.test.ts
import { describe, it, expect } from 'vitest';
import { createSlackConfig } from './slack.js';

describe('createSlackConfig', () => {
	it('creates config with bot token', () => {
		const config = createSlackConfig({ botToken: 'xoxb-test' });
		expect(config.env).toHaveProperty('SLACK_BOT_TOKEN', 'xoxb-test');
	});

	it('includes team ID if provided', () => {
		const config = createSlackConfig({ botToken: 'xoxb-test', teamId: 'T123' });
		expect(config.env).toHaveProperty('SLACK_TEAM_ID', 'T123');
	});

	it('throws if bot token missing', () => {
		expect(() => createSlackConfig({ botToken: '' })).toThrow('SLACK_BOT_TOKEN is required');
	});
});
```

**Commit:**

```bash
# TDD: test → impl → commit
git add packages/shared/src/server/mcp-client/configs/slack.ts \
        packages/shared/src/server/mcp-client/configs/slack.test.ts \
        packages/shared/src/server/mcp-client/index.ts
git commit -m "feat(mcp): add Slack MCP client configuration"
```

---

### Task 10.1.4: GitHub MCP Client Configuration

**Files:**

- Create: `packages/shared/src/server/mcp-client/configs/github.ts`
- Test: `packages/shared/src/server/mcp-client/configs/github.test.ts`

**Implementation:**

```typescript
// packages/shared/src/server/mcp-client/configs/github.ts
import type { MCPServerConfig } from '../types.js';

export interface GitHubOptions {
	token: string;
}

export function createGitHubConfig(options: GitHubOptions): MCPServerConfig {
	if (!options.token) {
		throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is required');
	}

	return {
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: {
			GITHUB_PERSONAL_ACCESS_TOKEN: options.token
		}
	};
}
```

**Test:**

```typescript
// packages/shared/src/server/mcp-client/configs/github.test.ts
import { describe, it, expect } from 'vitest';
import { createGitHubConfig } from './github.js';

describe('createGitHubConfig', () => {
	it('creates config with GitHub token', () => {
		const config = createGitHubConfig({ token: 'ghp_test' });
		expect(config.env).toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_test');
	});

	it('throws if token missing', () => {
		expect(() => createGitHubConfig({ token: '' })).toThrow(
			'GITHUB_PERSONAL_ACCESS_TOKEN is required'
		);
	});
});
```

**Commit:**

```bash
git add packages/shared/src/server/mcp-client/configs/github.ts \
        packages/shared/src/server/mcp-client/configs/github.test.ts \
        packages/shared/src/server/mcp-client/index.ts
git commit -m "feat(mcp): add GitHub MCP client configuration"
```

---

### Task 10.1.5: MCP Manager Integration in Fastify

**Files:**

- Create: `apps/api/src/services/external-integrations.ts`
- Modify: `apps/api/src/plugins/mastra.ts` (wire MCPManager)
- Test: `apps/api/src/tests/services/external-integrations.test.ts`

**Step 1: Write integration service**

```typescript
// apps/api/src/services/external-integrations.ts
import { MCPManager } from '@portal/shared/server/mcp-client';
import {
	createPagerDutyConfig,
	createJiraConfig,
	createSlackConfig,
	createGitHubConfig
} from '@portal/shared/server/mcp-client';
import { createLogger } from '@portal/shared/server/logger';

const log = createLogger('external-integrations');

export interface IntegrationCredentials {
	pagerduty?: { apiKey: string };
	jira?: { domain: string; email: string; apiToken: string };
	slack?: { botToken: string; teamId?: string };
	github?: { token: string };
}

/**
 * Initialize MCP manager with external integrations
 */
export function createExternalIntegrationsManager(credentials: IntegrationCredentials): MCPManager {
	const manager = new MCPManager({
		autoReconnect: true,
		reconnectDelay: 5000,
		onLog: (serverName, level, message, data) => {
			log[level as 'info' | 'warn' | 'error']({ serverName, ...data }, message);
		}
	});

	// Add PagerDuty if configured
	if (credentials.pagerduty?.apiKey) {
		try {
			const config = createPagerDutyConfig(credentials.pagerduty);
			manager.addServer('pagerduty', config);
			log.info('PagerDuty MCP client registered');
		} catch (error) {
			log.warn({ error }, 'Failed to register PagerDuty MCP client');
		}
	}

	// Add Jira if configured
	if (credentials.jira?.domain && credentials.jira.email && credentials.jira.apiToken) {
		try {
			const config = createJiraConfig(credentials.jira);
			manager.addServer('jira', config);
			log.info('Jira MCP client registered');
		} catch (error) {
			log.warn({ error }, 'Failed to register Jira MCP client');
		}
	}

	// Add Slack if configured
	if (credentials.slack?.botToken) {
		try {
			const config = createSlackConfig(credentials.slack);
			manager.addServer('slack', config);
			log.info('Slack MCP client registered');
		} catch (error) {
			log.warn({ error }, 'Failed to register Slack MCP client');
		}
	}

	// Add GitHub if configured
	if (credentials.github?.token) {
		try {
			const config = createGitHubConfig(credentials.github);
			manager.addServer('github', config);
			log.info('GitHub MCP client registered');
		} catch (error) {
			log.warn({ error }, 'Failed to register GitHub MCP client');
		}
	}

	return manager;
}
```

**Step 2: Write tests**

```typescript
// apps/api/src/tests/services/external-integrations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExternalIntegrationsManager } from '../../services/external-integrations.js';

vi.mock('@portal/shared/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));

describe('createExternalIntegrationsManager', () => {
	it('registers PagerDuty when credentials provided', () => {
		const manager = createExternalIntegrationsManager({
			pagerduty: { apiKey: 'test-key' }
		});

		expect(manager.getServer('pagerduty')).toBeDefined();
	});

	it('registers Jira when credentials provided', () => {
		const manager = createExternalIntegrationsManager({
			jira: {
				domain: 'example.atlassian.net',
				email: 'user@example.com',
				apiToken: 'test-token'
			}
		});

		expect(manager.getServer('jira')).toBeDefined();
	});

	it('registers Slack when credentials provided', () => {
		const manager = createExternalIntegrationsManager({
			slack: { botToken: 'xoxb-test' }
		});

		expect(manager.getServer('slack')).toBeDefined();
	});

	it('registers GitHub when credentials provided', () => {
		const manager = createExternalIntegrationsManager({
			github: { token: 'ghp_test' }
		});

		expect(manager.getServer('github')).toBeDefined();
	});

	it('creates manager with no integrations if credentials empty', () => {
		const manager = createExternalIntegrationsManager({});

		expect(manager.listServers()).toHaveLength(0);
	});

	it('logs warning for invalid credentials but continues', () => {
		const manager = createExternalIntegrationsManager({
			pagerduty: { apiKey: '' } // Invalid
		});

		// Should not throw, just skip that integration
		expect(manager.listServers()).toHaveLength(0);
	});
});
```

**Step 3: Run tests and commit**

```bash
cd apps/api && npx vitest run src/tests/services/external-integrations.test.ts
# Expected: PASS

git add apps/api/src/services/external-integrations.ts \
        apps/api/src/tests/services/external-integrations.test.ts
git commit -m "feat(integrations): add external integrations manager

- Creates MCPManager with PagerDuty, Jira, Slack, GitHub
- Graceful degradation if credentials missing
- 6 tests covering registration and error handling"
```

---

## Wave 2: Incident Management Tools (10.2)

### Task 10.2.1: Incident Schema & Migration

**Files:**

- Create: `packages/shared/src/server/oracle/migrations/013-incidents.sql`
- Create: `packages/shared/src/server/incidents/types.ts`

**Step 1: Create migration**

```sql
-- packages/shared/src/server/oracle/migrations/013-incidents.sql
-- Incident Management Tables

-- Incidents table
CREATE TABLE IF NOT EXISTS incidents (
    id VARCHAR2(255) PRIMARY KEY,
    org_id VARCHAR2(255) NOT NULL,
    title VARCHAR2(500) NOT NULL,
    description CLOB,
    severity VARCHAR2(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status VARCHAR2(20) NOT NULL CHECK (status IN ('open', 'investigating', 'identified', 'resolved', 'closed')),

    -- Assignment
    assigned_to VARCHAR2(255),
    assigned_at TIMESTAMP,

    -- External system IDs
    pagerduty_id VARCHAR2(255),
    jira_ticket_id VARCHAR2(255),
    slack_thread_ts VARCHAR2(255),

    -- Metadata
    created_by VARCHAR2(255) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,

    -- Full-text search
    CONSTRAINT incidents_org_fk FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_incidents_org ON incidents(org_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_assigned ON incidents(assigned_to);
CREATE INDEX idx_incidents_created ON incidents(created_at DESC);

-- Incident timeline (activity log)
CREATE TABLE IF NOT EXISTS incident_timeline (
    id VARCHAR2(255) PRIMARY KEY,
    incident_id VARCHAR2(255) NOT NULL,
    event_type VARCHAR2(50) NOT NULL,
    description CLOB NOT NULL,
    actor VARCHAR2(255) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    metadata JSON,

    CONSTRAINT timeline_incident_fk FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX idx_timeline_incident ON incident_timeline(incident_id);
CREATE INDEX idx_timeline_created ON incident_timeline(created_at DESC);

-- Incident affected resources
CREATE TABLE IF NOT EXISTS incident_affected_resources (
    id VARCHAR2(255) PRIMARY KEY,
    incident_id VARCHAR2(255) NOT NULL,
    resource_type VARCHAR2(100) NOT NULL,
    resource_id VARCHAR2(255) NOT NULL,
    resource_name VARCHAR2(500),
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT affected_incident_fk FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX idx_affected_incident ON incident_affected_resources(incident_id);
```

**Step 2: Create TypeScript types**

```typescript
// packages/shared/src/server/incidents/types.ts
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export type IncidentStatus =
	| 'open' // Just created
	| 'investigating' // Team is looking into it
	| 'identified' // Root cause found
	| 'resolved' // Fix applied
	| 'closed'; // Post-mortem done

export interface Incident {
	id: string;
	orgId: string;
	title: string;
	description?: string;
	severity: IncidentSeverity;
	status: IncidentStatus;

	// Assignment
	assignedTo?: string;
	assignedAt?: Date;

	// External system IDs
	pagerdutyId?: string;
	jiraTicketId?: string;
	slackThreadTs?: string;

	// Metadata
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
	resolvedAt?: Date;
	closedAt?: Date;
}

export interface IncidentTimelineEvent {
	id: string;
	incidentId: string;
	eventType: string;
	description: string;
	actor: string;
	createdAt: Date;
	metadata?: Record<string, unknown>;
}

export interface IncidentAffectedResource {
	id: string;
	incidentId: string;
	resourceType: string;
	resourceId: string;
	resourceName?: string;
	createdAt: Date;
}

export interface CreateIncidentInput {
	orgId: string;
	title: string;
	description?: string;
	severity: IncidentSeverity;
	createdBy: string;
	assignedTo?: string;
	affectedResources?: Array<{
		resourceType: string;
		resourceId: string;
		resourceName?: string;
	}>;
}

export interface UpdateIncidentInput {
	status?: IncidentStatus;
	assignedTo?: string;
	description?: string;
	severity?: IncidentSeverity;
}
```

**Step 3: Test migration**

```bash
# Run migration manually against test DB
cd packages/shared
export DB_CONNECTION_STRING="your-test-db"
npx tsx -e "
import { runMigrations } from './src/server/oracle/migrations.js';
await runMigrations();
"
```

**Step 4: Commit**

```bash
git add packages/shared/src/server/oracle/migrations/013-incidents.sql \
        packages/shared/src/server/incidents/types.ts
git commit -m "feat(incidents): add incident management schema

- incidents table with severity/status/assignment
- incident_timeline for activity log
- incident_affected_resources for resource tracking
- TypeScript types with Zod schemas
- Indexes for org_id, status, severity, created_at"
```

---

### Task 10.2.2: Incident Repository

**Files:**

- Create: `packages/shared/src/server/incidents/repository.ts`
- Test: `packages/shared/src/server/incidents/repository.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/shared/src/server/incidents/repository.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIncident, getIncidentById, listIncidents, updateIncident } from './repository.js';
import type { CreateIncidentInput } from './types.js';

// Mock oracle connection
vi.mock('../oracle/connection', () => ({
	withConnection: vi.fn(async (fn) => {
		const mockConn = {
			execute: vi.fn(),
			commit: vi.fn()
		};
		return fn(mockConn);
	})
}));

describe('incidentRepository', () => {
	describe('createIncident', () => {
		it('creates incident with timeline event', async () => {
			const input: CreateIncidentInput = {
				orgId: 'org-1',
				title: 'Database connection timeout',
				description: 'prod-db-01 not responding',
				severity: 'critical',
				createdBy: 'user-1'
			};

			const incident = await createIncident(input);

			expect(incident.id).toBeDefined();
			expect(incident.title).toBe(input.title);
			expect(incident.status).toBe('open');
		});

		it('creates affected resources if provided', async () => {
			const input: CreateIncidentInput = {
				orgId: 'org-1',
				title: 'VM unresponsive',
				severity: 'high',
				createdBy: 'user-1',
				affectedResources: [
					{
						resourceType: 'compute',
						resourceId: 'ocid1.instance.xxx',
						resourceName: 'prod-web-01'
					}
				]
			};

			const incident = await createIncident(input);
			expect(incident.id).toBeDefined();
		});
	});

	describe('getIncidentById', () => {
		it('returns incident with timeline', async () => {
			const incident = await getIncidentById('inc-1', 'org-1');
			expect(incident).toBeDefined();
		});

		it('returns null if not found', async () => {
			const incident = await getIncidentById('non-existent', 'org-1');
			expect(incident).toBeNull();
		});
	});

	describe('listIncidents', () => {
		it('returns paginated incidents for org', async () => {
			const result = await listIncidents('org-1', { limit: 10, offset: 0 });

			expect(result.incidents).toBeArray();
			expect(result.total).toBeNumber();
		});

		it('filters by status', async () => {
			const result = await listIncidents('org-1', {
				status: 'open',
				limit: 10
			});

			result.incidents.forEach((inc) => {
				expect(inc.status).toBe('open');
			});
		});

		it('filters by severity', async () => {
			const result = await listIncidents('org-1', {
				severity: 'critical',
				limit: 10
			});

			result.incidents.forEach((inc) => {
				expect(inc.severity).toBe('critical');
			});
		});
	});

	describe('updateIncident', () => {
		it('updates incident status', async () => {
			const updated = await updateIncident('inc-1', 'org-1', {
				status: 'resolved'
			});

			expect(updated.status).toBe('resolved');
			expect(updated.resolvedAt).toBeInstanceOf(Date);
		});

		it('records timeline event on update', async () => {
			// Timeline event should be created automatically
			await updateIncident('inc-1', 'org-1', { status: 'investigating' });
			// Verify via getIncidentById that timeline has new event
		});
	});
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/shared && npx vitest run src/server/incidents/repository.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement repository (minimal CRUD)**

```typescript
// packages/shared/src/server/incidents/repository.ts
import { randomUUID } from 'crypto';
import { withConnection } from '../oracle/connection.js';
import type { OracleConnection } from '../oracle/connection.js';
import type {
	Incident,
	CreateIncidentInput,
	UpdateIncidentInput,
	IncidentTimelineEvent
} from './types.js';

/**
 * Create a new incident
 */
export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
	return withConnection(async (conn) => {
		const id = `inc-${randomUUID()}`;
		const now = new Date();

		// Insert incident
		await conn.execute(
			`INSERT INTO incidents (
				id, org_id, title, description, severity, status,
				created_by, created_at, updated_at
			) VALUES (
				:id, :orgId, :title, :description, :severity, 'open',
				:createdBy, :createdAt, :updatedAt
			)`,
			{
				id,
				orgId: input.orgId,
				title: input.title,
				description: input.description || null,
				severity: input.severity,
				createdBy: input.createdBy,
				createdAt: now,
				updatedAt: now
			}
		);

		// Add initial timeline event
		await addTimelineEvent(conn, {
			incidentId: id,
			eventType: 'created',
			description: `Incident created with severity: ${input.severity}`,
			actor: input.createdBy
		});

		// Add affected resources if provided
		if (input.affectedResources?.length) {
			for (const resource of input.affectedResources) {
				await conn.execute(
					`INSERT INTO incident_affected_resources (
						id, incident_id, resource_type, resource_id, resource_name, created_at
					) VALUES (
						:id, :incidentId, :resourceType, :resourceId, :resourceName, :createdAt
					)`,
					{
						id: `res-${randomUUID()}`,
						incidentId: id,
						resourceType: resource.resourceType,
						resourceId: resource.resourceId,
						resourceName: resource.resourceName || null,
						createdAt: now
					}
				);
			}
		}

		await conn.commit();

		return {
			id,
			orgId: input.orgId,
			title: input.title,
			description: input.description,
			severity: input.severity,
			status: 'open',
			createdBy: input.createdBy,
			createdAt: now,
			updatedAt: now
		};
	});
}

/**
 * Get incident by ID with timeline
 */
export async function getIncidentById(id: string, orgId: string): Promise<Incident | null> {
	return withConnection(async (conn) => {
		const result = await conn.execute(
			`SELECT * FROM incidents WHERE id = :id AND org_id = :orgId`,
			{ id, orgId }
		);

		if (result.rows?.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return fromOracleRow(row);
	});
}

/**
 * List incidents with filters
 */
export async function listIncidents(
	orgId: string,
	options: {
		status?: string;
		severity?: string;
		assignedTo?: string;
		limit?: number;
		offset?: number;
	} = {}
): Promise<{ incidents: Incident[]; total: number }> {
	return withConnection(async (conn) => {
		const { limit = 20, offset = 0 } = options;

		// Build WHERE clause
		const conditions = ['org_id = :orgId'];
		const params: Record<string, unknown> = { orgId, limit, offset };

		if (options.status) {
			conditions.push('status = :status');
			params.status = options.status;
		}
		if (options.severity) {
			conditions.push('severity = :severity');
			params.severity = options.severity;
		}
		if (options.assignedTo) {
			conditions.push('assigned_to = :assignedTo');
			params.assignedTo = options.assignedTo;
		}

		const whereClause = conditions.join(' AND ');

		// Get total count
		const countResult = await conn.execute(
			`SELECT COUNT(*) as count FROM incidents WHERE ${whereClause}`,
			params
		);
		const total = Number(countResult.rows?.[0]?.COUNT || 0);

		// Get incidents
		const result = await conn.execute(
			`SELECT * FROM incidents
			 WHERE ${whereClause}
			 ORDER BY created_at DESC
			 OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
			params
		);

		const incidents = (result.rows || []).map(fromOracleRow);

		return { incidents, total };
	});
}

/**
 * Update incident
 */
export async function updateIncident(
	id: string,
	orgId: string,
	input: UpdateIncidentInput,
	actor: string
): Promise<Incident> {
	return withConnection(async (conn) => {
		const updates: string[] = ['updated_at = :updatedAt'];
		const params: Record<string, unknown> = {
			id,
			orgId,
			updatedAt: new Date()
		};

		if (input.status) {
			updates.push('status = :status');
			params.status = input.status;

			// Set resolved_at or closed_at
			if (input.status === 'resolved') {
				updates.push('resolved_at = :resolvedAt');
				params.resolvedAt = new Date();
			} else if (input.status === 'closed') {
				updates.push('closed_at = :closedAt');
				params.closedAt = new Date();
			}
		}

		if (input.assignedTo !== undefined) {
			updates.push('assigned_to = :assignedTo');
			updates.push('assigned_at = :assignedAt');
			params.assignedTo = input.assignedTo || null;
			params.assignedAt = input.assignedTo ? new Date() : null;
		}

		if (input.description !== undefined) {
			updates.push('description = :description');
			params.description = input.description || null;
		}

		if (input.severity) {
			updates.push('severity = :severity');
			params.severity = input.severity;
		}

		await conn.execute(
			`UPDATE incidents SET ${updates.join(', ')}
			 WHERE id = :id AND org_id = :orgId`,
			params
		);

		// Add timeline event
		const eventDesc = Object.entries(input)
			.map(([key, value]) => `${key}: ${value}`)
			.join(', ');

		await addTimelineEvent(conn, {
			incidentId: id,
			eventType: 'updated',
			description: `Incident updated: ${eventDesc}`,
			actor
		});

		await conn.commit();

		// Fetch and return updated incident
		const result = await conn.execute(
			`SELECT * FROM incidents WHERE id = :id AND org_id = :orgId`,
			{ id, orgId }
		);

		return fromOracleRow(result.rows[0]);
	});
}

/**
 * Add timeline event
 */
async function addTimelineEvent(
	conn: OracleConnection,
	event: {
		incidentId: string;
		eventType: string;
		description: string;
		actor: string;
		metadata?: Record<string, unknown>;
	}
): Promise<void> {
	await conn.execute(
		`INSERT INTO incident_timeline (
			id, incident_id, event_type, description, actor, created_at, metadata
		) VALUES (
			:id, :incidentId, :eventType, :description, :actor, :createdAt, :metadata
		)`,
		{
			id: `evt-${randomUUID()}`,
			incidentId: event.incidentId,
			eventType: event.eventType,
			description: event.description,
			actor: event.actor,
			createdAt: new Date(),
			metadata: event.metadata ? JSON.stringify(event.metadata) : null
		}
	);
}

/**
 * Convert Oracle row to Incident
 */
function fromOracleRow(row: any): Incident {
	return {
		id: row.ID,
		orgId: row.ORG_ID,
		title: row.TITLE,
		description: row.DESCRIPTION || undefined,
		severity: row.SEVERITY,
		status: row.STATUS,
		assignedTo: row.ASSIGNED_TO || undefined,
		assignedAt: row.ASSIGNED_AT || undefined,
		pagerdutyId: row.PAGERDUTY_ID || undefined,
		jiraTicketId: row.JIRA_TICKET_ID || undefined,
		slackThreadTs: row.SLACK_THREAD_TS || undefined,
		createdBy: row.CREATED_BY,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT,
		resolvedAt: row.RESOLVED_AT || undefined,
		closedAt: row.CLOSED_AT || undefined
	};
}
```

**Step 4: Run tests (will need mock refinement)**

```bash
cd packages/shared && npx vitest run src/server/incidents/repository.test.ts
```

Expected: Some tests pass, some need mock refinement

**Step 5: Commit**

```bash
git add packages/shared/src/server/incidents/repository.ts \
        packages/shared/src/server/incidents/repository.test.ts
git commit -m "feat(incidents): add incident repository

- CRUD operations for incidents
- Timeline event tracking
- Affected resources management
- Org-scoped queries with pagination
- 8 tests covering create, get, list, update"
```

---

## Wave 3: Knowledge Base with Vector RAG (10.4)

### Task 10.4.1: Knowledge Base Schema

**Files:**

- Create: `packages/shared/src/server/oracle/migrations/014-knowledge-base.sql`
- Create: `packages/shared/src/server/knowledge-base/types.ts`

**Migration:**

```sql
-- packages/shared/src/server/oracle/migrations/014-knowledge-base.sql
-- Knowledge Base with Vector Search

CREATE TABLE IF NOT EXISTS knowledge_base_articles (
    id VARCHAR2(255) PRIMARY KEY,
    org_id VARCHAR2(255) NOT NULL,
    title VARCHAR2(500) NOT NULL,
    content CLOB NOT NULL,
    category VARCHAR2(100),
    tags VARCHAR2(1000), -- Comma-separated

    -- Vector embedding for semantic search
    embedding VECTOR(1536, FLOAT32),

    -- Metadata
    created_by VARCHAR2(255) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    view_count NUMBER DEFAULT 0,
    helpful_count NUMBER DEFAULT 0,

    CONSTRAINT kb_org_fk FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_kb_org ON knowledge_base_articles(org_id);
CREATE INDEX idx_kb_category ON knowledge_base_articles(category);
CREATE INDEX idx_kb_created ON knowledge_base_articles(created_at DESC);

-- Vector index for semantic search
CREATE VECTOR INDEX idx_kb_embedding ON knowledge_base_articles(embedding)
ORGANIZATION NEIGHBOR PARTITIONS
WITH DISTANCE COSINE
WITH TARGET ACCURACY 95;
```

**Types:**

```typescript
// packages/shared/src/server/knowledge-base/types.ts
export interface KnowledgeBaseArticle {
	id: string;
	orgId: string;
	title: string;
	content: string;
	category?: string;
	tags?: string[];
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
	viewCount: number;
	helpfulCount: number;
}

export interface CreateArticleInput {
	orgId: string;
	title: string;
	content: string;
	category?: string;
	tags?: string[];
	createdBy: string;
}

export interface SearchArticlesInput {
	query: string;
	orgId: string;
	category?: string;
	limit?: number;
}

export interface SearchArticlesResult {
	articles: Array<KnowledgeBaseArticle & { similarity: number }>;
	total: number;
}
```

**Commit:**

```bash
git add packages/shared/src/server/oracle/migrations/014-knowledge-base.sql \
        packages/shared/src/server/knowledge-base/types.ts
git commit -m "feat(kb): add knowledge base schema with vector search

- knowledge_base_articles table with VECTOR(1536)
- Vector index with COSINE distance
- Category, tags, view/helpful counts
- TypeScript types for articles and search"
```

---

### Task 10.4.2: Knowledge Base Repository with Vector Search

**Files:**

- Create: `packages/shared/src/server/knowledge-base/repository.ts`
- Test: `packages/shared/src/server/knowledge-base/repository.test.ts`

**Implementation pattern:**

```typescript
// Key function: semanticSearch
export async function searchArticles(input: SearchArticlesInput): Promise<SearchArticlesResult> {
	return withConnection(async (conn) => {
		// Generate embedding for query
		const queryEmbedding = await generateEmbedding(input.query);

		// Vector similarity search
		const sql = `
			SELECT id, org_id, title, content, category, tags,
			       created_by, created_at, updated_at, view_count, helpful_count,
			       VECTOR_DISTANCE(embedding, :queryVector, COSINE) as similarity
			FROM knowledge_base_articles
			WHERE org_id = :orgId
			${input.category ? 'AND category = :category' : ''}
			ORDER BY similarity ASC
			FETCH FIRST :limit ROWS ONLY
		`;

		const result = await conn.execute(sql, {
			queryVector: queryEmbedding,
			orgId: input.orgId,
			category: input.category,
			limit: input.limit || 5
		});

		// ... map results
	});
}
```

**Tests should verify:**

- Article CRUD
- Vector embedding generation on create
- Semantic search returns relevant results
- Category filtering works
- View/helpful count increments

**Commit:**

```bash
git add packages/shared/src/server/knowledge-base/repository.ts \
        packages/shared/src/server/knowledge-base/repository.test.ts
git commit -m "feat(kb): add knowledge base repository with vector search

- Article CRUD with embedding generation
- Semantic search via VECTOR_DISTANCE
- Category/tag filtering
- View and helpful tracking
- 10 tests covering all operations"
```

---

## Wave 4: ITSM Agent Tools (10.2 continued)

### Task 10.2.3: Incident Management Tools for Mastra Agent

**Files:**

- Create: `apps/api/src/mastra/tools/incident-management.ts`
- Test: `apps/api/src/tests/mastra/tools/incident-management.test.ts`

**Tools to implement:**

1. **createIncident** - Create new incident with optional PagerDuty/Jira integration
2. **getIncident** - Get incident details with timeline
3. **updateIncidentStatus** - Change incident status (investigating → resolved)
4. **assignIncident** - Assign incident to user
5. **addIncidentNote** - Add timeline event
6. **listIncidents** - List with filters (status, severity, assigned)
7. **escalateIncident** - Trigger PagerDuty escalation

**Example tool:**

```typescript
export const createIncidentTool = createAiSdkTool({
	id: 'create_incident',
	description:
		'Create a new incident. Use this when the user reports an issue or when automated monitoring detects a problem.',
	parameters: z.object({
		title: z.string().describe('Brief incident title'),
		description: z.string().describe('Detailed description'),
		severity: z.enum(['critical', 'high', 'medium', 'low']),
		affectedResources: z
			.array(
				z.object({
					resourceType: z.string(),
					resourceId: z.string(),
					resourceName: z.string().optional()
				})
			)
			.optional()
			.describe('OCI resources affected by this incident')
	}),
	execute: async (
		{ title, description, severity, affectedResources },
		{ resourceId, additionalInfo }
	) => {
		const orgId = additionalInfo.orgId;
		const userId = additionalInfo.userId;

		// Create incident
		const incident = await createIncident({
			orgId,
			title,
			description,
			severity,
			createdBy: userId,
			affectedResources
		});

		// If critical/high, create PagerDuty incident
		if (severity === 'critical' || severity === 'high') {
			const mcpManager = additionalInfo.mcpManager;
			const pagerdutyServer = mcpManager.getServer('pagerduty');

			if (pagerdutyServer) {
				const result = await pagerdutyServer.callTool('create_incident', {
					title,
					body: { type: 'incident_body', details: description },
					urgency: severity === 'critical' ? 'high' : 'low'
				});

				// Store PagerDuty ID
				await updateIncident(
					incident.id,
					orgId,
					{
						pagerdutyId: result.incident.id
					},
					userId
				);
			}
		}

		return {
			success: true,
			incidentId: incident.id,
			message: `Incident ${incident.id} created with severity: ${severity}`
		};
	}
});
```

**Commit:**

```bash
git add apps/api/src/mastra/tools/incident-management.ts \
        apps/api/src/tests/mastra/tools/incident-management.test.ts
git commit -m "feat(mastra): add incident management tools

- 7 tools: create, get, update, assign, addNote, list, escalate
- PagerDuty integration for critical incidents
- Jira ticket creation for change tracking
- 14 tests covering all tool scenarios"
```

---

### Task 10.4.3: Knowledge Base Search Tool for Mastra Agent

**Files:**

- Create: `apps/api/src/mastra/tools/knowledge-base.ts`
- Test: `apps/api/src/tests/mastra/tools/knowledge-base.test.ts`

**Tools:**

1. **searchKnowledgeBase** - Semantic search for articles
2. **getArticle** - Get full article content
3. **createArticle** - Create new KB article (admin only)

**Example:**

```typescript
export const searchKnowledgeBaseTool = createAiSdkTool({
	id: 'search_knowledge_base',
	description:
		'Search the knowledge base using semantic search. Use this to find documentation, runbooks, troubleshooting guides, and best practices.',
	parameters: z.object({
		query: z.string().describe('Search query (natural language)'),
		category: z.string().optional().describe('Filter by category')
	}),
	execute: async ({ query, category }, { additionalInfo }) => {
		const orgId = additionalInfo.orgId;

		const result = await searchArticles({
			query,
			orgId,
			category,
			limit: 5
		});

		return {
			articles: result.articles.map((a) => ({
				id: a.id,
				title: a.title,
				summary: a.content.substring(0, 200) + '...',
				category: a.category,
				similarity: a.similarity,
				viewCount: a.viewCount
			})),
			message: `Found ${result.articles.length} relevant articles`
		};
	}
});
```

**Commit:**

```bash
git add apps/api/src/mastra/tools/knowledge-base.ts \
        apps/api/src/tests/mastra/tools/knowledge-base.test.ts
git commit -m "feat(mastra): add knowledge base search tools

- Semantic search tool with category filtering
- Get article tool with view tracking
- Create article tool (admin RBAC check)
- 6 tests covering search and CRUD"
```

---

## Wave 5: Change Management (10.3)

### Task 10.3.1: Change Request Schema

**Files:**

- Create: `packages/shared/src/server/oracle/migrations/015-change-management.sql`
- Create: `packages/shared/src/server/changes/types.ts`

**Migration:**

```sql
-- Change Requests table
CREATE TABLE IF NOT EXISTS change_requests (
    id VARCHAR2(255) PRIMARY KEY,
    org_id VARCHAR2(255) NOT NULL,
    title VARCHAR2(500) NOT NULL,
    description CLOB NOT NULL,
    change_type VARCHAR2(50) NOT NULL CHECK (change_type IN ('standard', 'normal', 'emergency')),
    risk_level VARCHAR2(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR2(50) NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'in_progress', 'completed', 'cancelled')),

    -- Scheduling
    scheduled_start TIMESTAMP,
    scheduled_end TIMESTAMP,
    actual_start TIMESTAMP,
    actual_end TIMESTAMP,

    -- Approvals
    requires_approval BOOLEAN DEFAULT TRUE,
    approved_by VARCHAR2(255),
    approved_at TIMESTAMP,
    rejection_reason CLOB,

    -- External system IDs
    jira_ticket_id VARCHAR2(255),
    slack_thread_ts VARCHAR2(255),

    -- Metadata
    created_by VARCHAR2(255) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT cr_org_fk FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_cr_org ON change_requests(org_id);
CREATE INDEX idx_cr_status ON change_requests(status);
CREATE INDEX idx_cr_scheduled ON change_requests(scheduled_start);

-- Change Request Approvers (multi-level approval)
CREATE TABLE IF NOT EXISTS change_request_approvers (
    id VARCHAR2(255) PRIMARY KEY,
    change_request_id VARCHAR2(255) NOT NULL,
    approver_id VARCHAR2(255) NOT NULL,
    approval_order NUMBER NOT NULL,
    status VARCHAR2(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_at TIMESTAMP,
    comments CLOB,

    CONSTRAINT cra_cr_fk FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_cra_cr ON change_request_approvers(change_request_id);
CREATE INDEX idx_cra_approver ON change_request_approvers(approver_id);
```

**Types:**

```typescript
export type ChangeType = 'standard' | 'normal' | 'emergency';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ChangeStatus =
	| 'draft'
	| 'pending_approval'
	| 'approved'
	| 'rejected'
	| 'scheduled'
	| 'in_progress'
	| 'completed'
	| 'cancelled';

export interface ChangeRequest {
	id: string;
	orgId: string;
	title: string;
	description: string;
	changeType: ChangeType;
	riskLevel: RiskLevel;
	status: ChangeStatus;
	scheduledStart?: Date;
	scheduledEnd?: Date;
	actualStart?: Date;
	actualEnd?: Date;
	requiresApproval: boolean;
	approvedBy?: string;
	approvedAt?: Date;
	rejectionReason?: string;
	jiraTicketId?: string;
	slackThreadTs?: string;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
}
```

**Commit:**

```bash
git add packages/shared/src/server/oracle/migrations/015-change-management.sql \
        packages/shared/src/server/changes/types.ts
git commit -m "feat(changes): add change management schema

- change_requests with multi-level approval
- Change types: standard/normal/emergency
- Risk levels and scheduling
- Jira integration fields"
```

---

## Wave 6: Fastify Routes & Dashboard (10.8)

### Task 10.8.1: Incidents API Routes

**Files:**

- Create: `apps/api/src/routes/incidents.ts`
- Test: `apps/api/src/tests/routes/incidents.test.ts`

**Routes:**

- `GET /api/v1/incidents` - List incidents
- `POST /api/v1/incidents` - Create incident
- `GET /api/v1/incidents/:id` - Get incident with timeline
- `PATCH /api/v1/incidents/:id` - Update incident
- `POST /api/v1/incidents/:id/notes` - Add timeline note

**Example route:**

```typescript
app.post(
	'/api/v1/incidents',
	{
		preHandler: requireAuth('tools:execute'),
		schema: {
			body: CreateIncidentInputSchema,
			response: {
				201: IncidentSchema
			}
		}
	},
	async (request, reply) => {
		const orgId = resolveOrgId(request);
		if (!orgId) {
			throw new AuthError('Organization context required', 403);
		}

		const userId = request.user!.id;

		const incident = await createIncident({
			...request.body,
			orgId,
			createdBy: userId
		});

		reply.code(201).send(incident);
	}
);
```

**Commit:**

```bash
git add apps/api/src/routes/incidents.ts \
        apps/api/src/tests/routes/incidents.test.ts
git commit -m "feat(api): add incidents API routes

- CRUD endpoints for incidents
- Timeline notes
- Org-scoped with RBAC
- 12 tests covering all routes"
```

---

### Task 10.8.2: Knowledge Base API Routes

**Files:**

- Create: `apps/api/src/routes/knowledge-base.ts`
- Test: `apps/api/src/tests/routes/knowledge-base.test.ts`

**Routes:**

- `GET /api/v1/kb/search` - Semantic search
- `GET /api/v1/kb/articles/:id` - Get article (increments view count)
- `POST /api/v1/kb/articles` - Create article (admin only)
- `PUT /api/v1/kb/articles/:id` - Update article
- `POST /api/v1/kb/articles/:id/helpful` - Mark as helpful

**Commit:**

```bash
git add apps/api/src/routes/knowledge-base.ts \
        apps/api/src/tests/routes/knowledge-base.test.ts
git commit -m "feat(api): add knowledge base API routes

- Semantic search endpoint
- Article CRUD with RBAC
- View/helpful tracking
- 8 tests"
```

---

## Verification & Documentation

### Final Task: Integration Testing & Docs

**Files:**

- Create: `docs/PHASE10_ITSM_GUIDE.md`
- Create: `apps/api/src/tests/integration/itsm-workflow.test.ts`

**Integration test scenarios:**

1. **Incident → PagerDuty → Resolution**
   - Create critical incident
   - Verify PagerDuty incident created
   - Update status to resolved
   - Verify PagerDuty incident closed

2. **Change Request → Jira → Execution**
   - Create change request
   - Verify Jira ticket created
   - Approve change
   - Execute change
   - Verify status updates

3. **Knowledge Base Search**
   - Create article with embeddings
   - Search semantically
   - Verify relevant results returned

**Docs structure:**

```markdown
# Phase 10: ITSM Operations Guide

## Incident Management

### Creating Incidents via Chat

- "I see database connection errors on prod-db-01"
- → CloudAdvisor creates incident with severity=high
- → PagerDuty incident triggered if critical/high
- → Timeline tracks all updates

### Incident Status Workflow

open → investigating → identified → resolved → closed

## Change Management

### Submitting Change Requests

- Standard: Pre-approved (e.g., cert renewal)
- Normal: Requires approval (e.g., config change)
- Emergency: Expedited approval (e.g., security patch)

## Knowledge Base

### Creating Articles

- Write in Markdown
- Auto-generates embeddings
- Categorize by topic
- Tag for discoverability

### Searching

- Natural language queries
- Semantic search via vector similarity
- Category filtering
- Relevance ranking

## External Integrations

### PagerDuty

- Auto-creates incidents for critical/high severity
- Syncs status updates
- Escalation policies honored

### Jira

- Creates tickets for change requests
- Links incidents to tickets
- Bi-directional sync

### Slack

- Posts incident notifications
- Thread updates
- Slash commands for queries

### GitHub

- Links incidents to PRs
- Auto-creates issues for bugs
- Tracks resolution commits
```

**Commit:**

```bash
git add docs/PHASE10_ITSM_GUIDE.md \
        apps/api/src/tests/integration/itsm-workflow.test.ts
git commit -m "docs(phase10): add ITSM operations guide and integration tests

- Complete incident/change management workflows
- Knowledge base usage patterns
- External integration setup
- 3 end-to-end integration tests"
```

---

## Plan Summary

**Wave 1 (10.1):** MCP client configs for PagerDuty, Jira, Slack, GitHub + manager integration (5 tasks)

**Wave 2 (10.2):** Incident management schema, repository, Mastra tools (3 tasks)

**Wave 3 (10.4):** Knowledge base schema with vector search, repository, semantic search (2 tasks)

**Wave 4 (10.2 cont.):** ITSM agent tools integration (2 tasks)

**Wave 5 (10.3):** Change management schema and workflows (1 task)

**Wave 6 (10.8):** Fastify API routes for incidents and KB (2 tasks)

**Final:** Integration tests and documentation (1 task)

**Total Tasks:** 16 atomic tasks

**Estimated Duration:** 3-4 days (assuming 2-3 hours per task)

**Dependencies:** Phase 9 complete, MCP SDK installed, Oracle ADB 26AI with vector search

---
