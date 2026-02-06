import type { WorkflowStep, AgentPlan } from '$lib/components/panels/types.js';

/**
 * Supported workflow icon IDs (map to SVGs)
 */
export type WorkflowIconId =
	| 'server'
	| 'database'
	| 'storage'
	| 'network'
	| 'lock'
	| 'money'
	| 'gift';

/**
 * Pre-defined workflow templates for common OCI operations
 */
export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	icon: WorkflowIconId;
	category: 'compute' | 'networking' | 'database' | 'pricing' | 'storage' | 'security';
	steps: Omit<WorkflowStep, 'status'>[];
	/** Estimated duration in minutes */
	estimatedDuration: number;
	/** Tags for filtering/searching */
	tags: string[];
}

/**
 * Create an AgentPlan from a workflow template
 */
export function createPlanFromTemplate(template: WorkflowTemplate): AgentPlan {
	return {
		id: `${template.id}-${Date.now()}`,
		name: template.name,
		description: template.description,
		status: 'idle',
		steps: template.steps.map((step) => ({
			...step,
			status: 'pending' as const
		}))
	};
}

/**
 * Pre-defined workflow templates
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
	// ===== COMPUTE WORKFLOWS =====
	{
		id: 'provision-web-server',
		name: 'Provision Web Server',
		description: 'Deploy a compute instance with networking for hosting web applications',
		icon: 'server',
		category: 'compute',
		estimatedDuration: 5,
		tags: ['compute', 'vm', 'web', 'deploy', 'terraform'],
		steps: [
			{
				id: '1',
				name: 'Gather Requirements',
				description:
					'Ask about vCPUs, memory, OS, region, and purpose. Suggest smart defaults: 2 vCPUs/8GB for web servers, Oracle Linux 8 for best OCI optimization. Ask if dev/test or production (affects HA and sizing recommendations).'
			},
			{
				id: '2',
				name: 'List Compartments',
				description:
					'Find available compartments. Present as a table: Name | Description | State. Recommend the most appropriate compartment for the workload.',
				toolName: 'listCompartments'
			},
			{
				id: '3',
				name: 'Check Availability Domains',
				description:
					'List ADs in the region. For production, recommend spreading across multiple ADs. For dev/test, any single AD is fine.',
				toolName: 'listAvailabilityDomains',
				dependencies: ['2']
			},
			{
				id: '4',
				name: 'List Available Shapes',
				description:
					'Show shapes matching requirements. Present as a comparison table: Shape | Architecture | OCPU Range | Memory Range | Price/hr. Highlight ARM shapes as cheaper. Bold the recommended shape. If config qualifies for Always Free, call it out prominently.',
				toolName: 'listShapes',
				dependencies: ['3']
			},
			{
				id: '5',
				name: 'List OS Images',
				description:
					'Find compatible OS images. Recommend Oracle Linux 8 for OCI-optimized performance. For containers, suggest Ubuntu 22.04. Filter by the selected shape for compatibility.',
				toolName: 'listImages',
				dependencies: ['4']
			},
			{
				id: '6',
				name: 'Check Network Infrastructure',
				description:
					'Analyze existing VCNs and subnets. If a suitable VCN exists, reuse it. If not, the Terraform generation will create one. Present findings in a table.',
				toolName: 'listVcns',
				dependencies: ['2']
			},
			{
				id: '7',
				name: 'Generate Terraform Code',
				description:
					'Generate Terraform for the full web server stack. Present each file in a fenced ```hcl code block. Offer to generate a Mermaid architecture diagram showing VCN, subnets, gateways, and compute instance.',
				toolName: 'generateTerraform',
				dependencies: ['4', '5', '6']
			},
			{
				id: '8',
				name: 'Review & Deploy',
				description:
					'Present a summary table of all resources to be created, estimated monthly cost, and numbered deployment steps (terraform init → plan → apply). Offer to compare final cost with Azure.',
				dependencies: ['7']
			}
		]
	},

	// ===== PRICING WORKFLOWS =====
	{
		id: 'cloud-cost-comparison',
		name: 'Cloud Cost Analysis',
		description: 'Compare OCI vs Azure pricing for your workload requirements',
		icon: 'money',
		category: 'pricing',
		estimatedDuration: 2,
		tags: ['pricing', 'cost', 'comparison', 'azure', 'oci'],
		steps: [
			{
				id: '1',
				name: 'Gather Workload Requirements',
				description:
					'Ask about vCPUs, memory, storage, egress needs, and hours/month. Suggest typical configs: web server (2 vCPU/8GB), API backend (4 vCPU/16GB), data processing (8+ vCPU/32GB+).'
			},
			{
				id: '2',
				name: 'Fetch OCI Pricing',
				description:
					'Get Oracle Cloud pricing. Present matching shapes as a table with hourly and monthly costs. Highlight the cheapest option and any Always Free eligible shapes.',
				toolName: 'getOCIPricing',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Fetch Azure Pricing',
				description:
					'Get Azure VM pricing for equivalent specs. Present as a comparison-ready table with the same columns as OCI pricing.',
				toolName: 'getAzurePricing',
				dependencies: ['1']
			},
			{
				id: '4',
				name: 'Compare & Analyze',
				description:
					'Present the full formatted comparison report directly (includes tables, breakdowns, reasoning). Bold the savings percentage and monthly difference.',
				toolName: 'compareCloudCosts',
				dependencies: ['2', '3']
			},
			{
				id: '5',
				name: 'Generate Recommendation',
				description:
					'Synthesize findings into a clear recommendation: (1) recommended provider with reasoning, (2) estimated annual savings, (3) trade-offs to consider, (4) next steps. Offer to generate Terraform for the recommended option.',
				dependencies: ['4']
			}
		]
	},

	{
		id: 'oci-free-tier-setup',
		name: 'Free Tier Optimization',
		description: 'Maximize OCI Always Free tier resources for your project',
		icon: 'gift',
		category: 'pricing',
		estimatedDuration: 3,
		tags: ['free', 'always-free', 'optimization', 'starter'],
		steps: [
			{
				id: '1',
				name: 'Review Free Tier Limits',
				description:
					'Present Always Free resources as a structured summary: Compute (4 ARM OCPUs, 24GB), Storage (200GB block, 20GB object), Database (2 ADBs with 20GB each), Networking (10TB egress). Compare with Azure Free Tier.',
				toolName: 'getOCIFreeTier'
			},
			{
				id: '2',
				name: 'Analyze Current Usage',
				description:
					'List existing instances. Compare current usage against free tier limits in a table: Resource | Used | Free Limit | Remaining. Flag anything that exceeds free tier.',
				toolName: 'listInstances',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Identify Optimization',
				description:
					'Recommend specific configurations that fit within free limits. Suggest ARM shapes (A1.Flex) for best value. Calculate how many web servers or APIs can run within free tier.',
				dependencies: ['1', '2']
			},
			{
				id: '4',
				name: 'Generate Setup Plan',
				description:
					'Create a numbered deployment plan that stays within free limits. Include specific shape configs, storage allocation, and networking setup. Offer to generate Terraform code.',
				dependencies: ['3']
			}
		]
	},

	// ===== DATABASE WORKFLOWS =====
	{
		id: 'setup-autonomous-database',
		name: 'Setup Autonomous Database',
		description: 'Provision an Oracle Autonomous Database with vector search capabilities',
		icon: 'database',
		category: 'database',
		estimatedDuration: 8,
		tags: ['database', 'adb', 'autonomous', 'vector', 'ai'],
		steps: [
			{
				id: '1',
				name: 'Define Database Requirements',
				description:
					'Ask about use case, data volume, and performance needs. Explain workload types in a table: OLTP (transactions, APIs), DW (analytics, reporting), AJD (JSON documents), APEX (low-code apps). For AI/vector search, recommend OLTP with Oracle 26AI.'
			},
			{
				id: '2',
				name: 'Check Existing Databases',
				description:
					'List existing databases. Present as a table: Name | Workload | State | ECPUs | Storage. Check if Always Free slots are available (2 max). Flag any stopped databases.',
				toolName: 'listAutonomousDatabases',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Select Configuration',
				description:
					'Present recommended configuration based on requirements. Show a comparison table of workload types with features and pricing. Bold the recommended option. Mention Always Free eligibility (1 ECPU, 20GB).',
				dependencies: ['1', '2']
			},
			{
				id: '4',
				name: 'Create Database',
				description:
					'Create the database with confirmed settings. Present a summary of the configuration before creating. After creation, show the database OCID and state.',
				toolName: 'createAutonomousDatabase',
				dependencies: ['3']
			},
			{
				id: '5',
				name: 'Configure Networking',
				description:
					'Recommend private endpoint for production (never public for databases). Explain the security benefit. If VCN exists, suggest using it; otherwise suggest creating one.',
				dependencies: ['4']
			},
			{
				id: '6',
				name: 'Download Wallet',
				description:
					'Guide through wallet download for secure database connections. Explain that the wallet contains TLS certificates and connection strings. Provide sample connection code.',
				dependencies: ['4']
			},
			{
				id: '7',
				name: 'Verify Connection',
				description:
					'Provide connection verification steps with sample code in ```sql and ```python code blocks. Test with a simple SELECT query. Confirm the database is operational.',
				dependencies: ['6']
			}
		]
	},

	// ===== STORAGE WORKFLOWS =====
	{
		id: 'setup-object-storage',
		name: 'Setup Object Storage',
		description: 'Create and configure an Object Storage bucket with appropriate access controls',
		icon: 'storage',
		category: 'storage',
		estimatedDuration: 3,
		tags: ['storage', 'bucket', 'object-storage', 's3-compatible'],
		steps: [
			{
				id: '1',
				name: 'Define Storage Requirements',
				description:
					'Ask about data type, expected volume, access frequency, and retention needs. Explain storage tiers: Standard (frequent access), Infrequent Access (monthly), Archive (yearly). Mention 10TB/month free egress.'
			},
			{
				id: '2',
				name: 'List Existing Buckets',
				description:
					'Show current buckets as a table: Name | Tier | Public Access | Created. Flag any with public access as a security concern.',
				toolName: 'listBuckets',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Create Bucket',
				description:
					'Create with NoPublicAccess default. Present the configuration for confirmation. After creation, mention S3-compatible API access for tool integration.',
				toolName: 'createBucket',
				dependencies: ['1', '2']
			},
			{
				id: '4',
				name: 'Configure Lifecycle',
				description:
					'Suggest lifecycle rules based on retention needs. Example: move to Infrequent Access after 30 days, Archive after 90 days, delete after 365 days. Present as a table.',
				dependencies: ['3']
			},
			{
				id: '5',
				name: 'Setup IAM Policy',
				description:
					'Draft least-privilege policy statements for bucket access. Present the policy statements for review. Scope to specific compartment and bucket name.',
				toolName: 'createPolicy',
				dependencies: ['3']
			},
			{
				id: '6',
				name: 'Verify Access',
				description:
					'Provide sample commands to test bucket access: OCI CLI for upload/download, S3-compatible endpoint for tool integration. Present in ```bash code blocks.',
				dependencies: ['5']
			}
		]
	},

	// ===== NETWORKING WORKFLOWS =====
	{
		id: 'setup-private-network',
		name: 'Setup Private Network',
		description: 'Create a secure VCN with public and private subnets',
		icon: 'network',
		category: 'networking',
		estimatedDuration: 4,
		tags: ['networking', 'vcn', 'subnet', 'security'],
		steps: [
			{
				id: '1',
				name: 'Plan Network Architecture',
				description:
					'Ask about the workload and generate a Mermaid diagram of the proposed architecture. Recommend /16 CIDR for VCN, /24 for subnets. Suggest multi-tier: public (web/LB) + private (app/DB). Mention Service Gateway for free OCI egress.'
			},
			{
				id: '2',
				name: 'Check Existing VCNs',
				description:
					'List existing VCNs as a table. Check for CIDR conflicts with the proposed network. If a suitable VCN exists, suggest reusing it.',
				toolName: 'listVcns',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Create VCN',
				description:
					'Create VCN with the planned CIDR. After creation, show the VCN OCID and DNS label. Mention that Terraform is the preferred approach for reproducible setups.',
				toolName: 'createVcn',
				dependencies: ['1', '2']
			},
			{
				id: '4',
				name: 'Create Public Subnet',
				description:
					'Configure public subnet with internet gateway for web-facing services. Explain that instances here get public IPs. Show the CIDR allocation.',
				dependencies: ['3']
			},
			{
				id: '5',
				name: 'Create Private Subnet',
				description:
					'Configure private subnet with NAT gateway for backend services. Explain that instances here access the internet through NAT (outbound only). Recommend for databases and app servers.',
				dependencies: ['3']
			},
			{
				id: '6',
				name: 'Configure Security Lists',
				description:
					'Draft security rules following least-privilege. Present as a table: Direction | Source/Dest | Protocol | Port | Description. Default deny all, explicitly allow needed traffic (HTTP/HTTPS, SSH from bastion only).',
				dependencies: ['4', '5']
			},
			{
				id: '7',
				name: 'Verify Connectivity',
				description:
					'Generate a final Mermaid architecture diagram showing the complete network topology. Provide verification steps and next steps for deploying resources into the network.',
				dependencies: ['6']
			}
		]
	},

	// ===== SECURITY WORKFLOWS =====
	{
		id: 'setup-iam-policy',
		name: 'Setup IAM Policies',
		description: 'Create compartment structure and IAM policies for team access',
		icon: 'lock',
		category: 'security',
		estimatedDuration: 3,
		tags: ['iam', 'security', 'policy', 'access'],
		steps: [
			{
				id: '1',
				name: 'Define Access Requirements',
				description:
					'Ask about who needs access (users/groups), what resources they need, and what actions (read, manage, use). Explain the OCI IAM model: policies attach to compartments and grant access to groups.'
			},
			{
				id: '2',
				name: 'List Compartments',
				description:
					'Show compartment hierarchy as a table. Recommend scoping policies to the most specific compartment possible (least-privilege). Never suggest tenancy-level "manage all-resources" policies.',
				toolName: 'listCompartments',
				dependencies: ['1']
			},
			{
				id: '3',
				name: 'Review Existing Policies',
				description:
					'List current policies. Flag any overly broad policies (manage all-resources, tenancy-level). Present as a table: Name | Scope | Statement Count. Check for conflicts with proposed new policy.',
				toolName: 'listPolicies',
				dependencies: ['2']
			},
			{
				id: '4',
				name: 'Draft Policy Statements',
				description:
					'Draft specific policy statements following least-privilege. Present each statement with an explanation. Use format: "Allow group <group> to <verb> <resource-type> in compartment <name>". Present for user review before creating.',
				dependencies: ['1', '3']
			},
			{
				id: '5',
				name: 'Create Policy',
				description:
					'Create the policy with approved statements. Show the created policy OCID and confirm all statements were applied. Warn that policy propagation may take a few minutes.',
				toolName: 'createPolicy',
				dependencies: ['4']
			},
			{
				id: '6',
				name: 'Verify Access',
				description:
					'Provide verification steps: which CLI commands or console actions the user should test to confirm the policy works. Present as a numbered checklist.',
				dependencies: ['5']
			}
		]
	}
];

/**
 * Get workflow templates by category
 */
export function getWorkflowsByCategory(category: WorkflowTemplate['category']): WorkflowTemplate[] {
	return WORKFLOW_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Search workflow templates by name or tags
 */
export function searchWorkflows(query: string): WorkflowTemplate[] {
	const lowerQuery = query.toLowerCase();
	return WORKFLOW_TEMPLATES.filter(
		(t) =>
			t.name.toLowerCase().includes(lowerQuery) ||
			t.description.toLowerCase().includes(lowerQuery) ||
			t.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
	);
}

/**
 * Get a workflow template by ID
 */
export function getWorkflowById(id: string): WorkflowTemplate | undefined {
	return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get SVG icon for a workflow icon ID
 */
export function getWorkflowIconSvg(iconId: WorkflowIconId): string {
	const icons: Record<WorkflowIconId, string> = {
		server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <rect x="2" y="2" width="20" height="8" rx="1"/>
      <path d="M6 14h12M6 18h12"/>
    </svg>`,
		database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
    </svg>`,
		storage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>`,
		network: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <circle cx="12" cy="12" r="2"/>
      <circle cx="19" cy="5" r="2"/>
      <circle cx="5" cy="5" r="2"/>
      <circle cx="19" cy="19" r="2"/>
      <circle cx="5" cy="19" r="2"/>
      <path d="M12 14v3M12 10V7M7 7l-2 2M17 7l2 2M7 17l-2 -2M17 17l2 -2"/>
    </svg>`,
		lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>`,
		money: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <circle cx="12" cy="12" r="1"/>
      <path d="M12 1v6m0 6v4"/>
      <path d="M4.22 4.22l4.24 4.24m5.08 0l4.24-4.24"/>
      <path d="M1 12h6m6 0h6"/>
      <path d="M4.22 19.78l4.24-4.24m5.08 0l4.24 4.24"/>
    </svg>`,
		gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <polyline points="20 12 20 2 4 2 4 12"/>
      <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
      <path d="M12 7v10M7 12h10"/>
    </svg>`
	};
	return icons[iconId];
}
