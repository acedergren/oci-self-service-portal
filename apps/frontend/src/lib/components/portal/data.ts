import type { ServiceCategory, QuickAction, ResourceLink } from './types.js';

/** Service categories for the portal grid */
export const SERVICE_CATEGORIES: ServiceCategory[] = [
	{
		id: 'compute',
		title: 'Compute Resources',
		description:
			'Virtual machines with flexible shapes — choose exact vCPUs, memory, and architecture (x86 or ARM)',
		icon: 'server',
		color: 'teal',
		actions: [
			{
				label: 'View my instances',
				prompt:
					'List all my compute instances and summarize their state, shapes, and resource usage in a table. Highlight any stopped instances as potential cost savings.'
			},
			{
				label: 'Deploy new server',
				prompt:
					'Help me deploy a new compute instance. Walk me through shape selection, pricing comparison with Azure, and generate Terraform code.'
			},
			{
				label: 'Right-size recommendations',
				prompt:
					'Analyze my running instances and recommend right-sizing opportunities. Check if any could benefit from ARM shapes for cost savings.'
			}
		]
	},
	{
		id: 'database',
		title: 'Database Services',
		description:
			'Oracle Autonomous Database with built-in AI, vector search, and automatic patching',
		icon: 'database',
		color: 'indigo',
		actions: [
			{
				label: 'View my databases',
				prompt:
					'List all my Autonomous Databases with their workload types, state, ECPU count, and storage. Flag any that are Always Free eligible.'
			},
			{
				label: 'Create database',
				prompt:
					'Help me create an Oracle Autonomous Database. Explain the workload types and recommend one based on my needs, then walk me through creation.'
			},
			{
				label: 'Database health check',
				prompt:
					'Check the health and configuration of my databases. Are they properly sized? Could any be downgraded to save costs?'
			}
		]
	},
	{
		id: 'networking',
		title: 'Networking',
		description: 'Virtual Cloud Networks with free 10TB/month egress and Service Gateway',
		icon: 'network',
		color: 'emerald',
		actions: [
			{
				label: 'View my networks',
				prompt:
					'List all my VCNs and subnets in a table. Show CIDR blocks, public/private types, and generate a Mermaid network topology diagram.'
			},
			{
				label: 'Create private network',
				prompt:
					'Help me set up a secure VCN with public and private subnets, internet gateway, NAT gateway, and Service Gateway for free OCI egress.'
			},
			{
				label: 'Security review',
				prompt:
					'Review my network security: check security lists for overly permissive rules, flag any public subnets hosting databases, and suggest improvements.'
			}
		]
	},
	{
		id: 'storage',
		title: 'Object Storage',
		description: 'S3-compatible storage with 10TB/month free egress and automatic tiering',
		icon: 'storage',
		color: 'amber',
		actions: [
			{
				label: 'View my buckets',
				prompt:
					'List all my Object Storage buckets. Flag any with public access as a security concern. Show storage tier and creation date.'
			},
			{
				label: 'Create bucket',
				prompt:
					'Help me create a new Object Storage bucket with NoPublicAccess default. Suggest lifecycle rules for archival and an IAM policy for access control.'
			},
			{
				label: 'Storage cost analysis',
				prompt:
					'Analyze my Object Storage usage. Compare costs with Azure Blob Storage including egress pricing. Suggest tier optimization.'
			}
		]
	},
	{
		id: 'identity',
		title: 'Identity & Access',
		description: 'IAM policies, compartments, and least-privilege access control',
		icon: 'shield',
		color: 'rose',
		actions: [
			{
				label: 'View compartments',
				prompt:
					'List my compartments and their hierarchy. Explain how compartments organize resources and control access.'
			},
			{
				label: 'Audit IAM policies',
				prompt:
					'List all IAM policies and audit them for security. Flag overly broad policies (manage all-resources in tenancy) and suggest least-privilege alternatives.'
			},
			{
				label: 'Create access policy',
				prompt:
					"Help me create a new IAM policy. I'll describe who needs access to what, and you draft the policy statements following least-privilege principles."
			}
		]
	},
	{
		id: 'monitoring',
		title: 'Monitoring & Alerts',
		description: 'Metrics, alarms, and log analytics for operational visibility',
		icon: 'chart',
		color: 'violet',
		actions: [
			{
				label: 'View alarms',
				prompt:
					'List all my monitoring alarms. Highlight any that are currently FIRING. If no alarms exist, suggest creating basic health alarms for CPU, memory, and disk.'
			},
			{
				label: 'Create health alarms',
				prompt:
					'Help me set up monitoring alarms for my compute instances: CPU > 80%, memory > 90%, and disk usage > 85%. Walk me through the configuration.'
			},
			{
				label: 'Query metrics',
				prompt:
					'Help me query performance metrics for my resources. What time period and metrics are you interested in? (CPU, memory, network, disk I/O)'
			}
		]
	}
];

/** Quick action pills for the hero section */
export const QUICK_ACTIONS: QuickAction[] = [
	{
		label: 'Infrastructure health check',
		prompt:
			'Run a comprehensive health check: list all my compute instances, databases, and VCNs. Summarize their state, flag any stopped instances or security concerns, and suggest cost optimizations.'
	},
	{
		label: 'Cost optimization review',
		prompt:
			'Analyze my current OCI resources for cost optimization: check for stopped instances (wasted spend), suggest ARM migration opportunities, identify Always Free tier eligibility, and compare total cost with Azure equivalent.'
	},
	{
		label: 'Deploy a web app',
		prompt:
			'Help me deploy a new web application on OCI. Walk me through the full provisioning workflow: requirements, shape selection, pricing comparison with Azure, and Terraform code generation.'
	},
	{
		label: 'Security posture review',
		prompt:
			'Audit my OCI security posture: review IAM policies for overly broad permissions, check for public-facing resources (buckets, instances), and recommend security improvements.'
	},
	{
		label: 'Compare OCI vs Azure',
		prompt:
			'Compare OCI and Azure costs for a production workload: 4 vCPUs, 16GB RAM, 200GB SSD storage, running 24/7 with 500GB/month egress. Include the egress cost difference.'
	},
	{
		label: 'Network topology',
		prompt:
			'Map my network topology: list all VCNs and their subnets, show which are public vs private, and generate a Mermaid architecture diagram of the network layout.'
	},
	{
		label: 'Free tier starter guide',
		prompt:
			"I want to maximize the OCI Always Free tier. Show me what's included, check my current usage against the limits, and suggest a deployment plan that fits entirely within free resources."
	},
	{
		label: 'Database setup wizard',
		prompt:
			'Help me set up an Oracle Autonomous Database. Explain the workload types (OLTP, DW, AJD, APEX), recommend one for my use case, and walk me through the creation process.'
	}
];

/** External resource links for the bottom panel */
export const RESOURCE_LINKS: ResourceLink[] = [
	{ label: 'OCI Documentation', href: 'https://docs.oracle.com/en-us/iaas/Content/home.htm' },
	{
		label: 'CLI Reference Guide',
		href: 'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/cliconcepts.htm'
	},
	{
		label: 'Free Tier Resources',
		href: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm'
	},
	{ label: 'OCI Console', href: 'https://cloud.oracle.com/compute/instances' }
];

/** IDs of featured workflows to show on the portal */
export const FEATURED_WORKFLOW_IDS = [
	'cloud-cost-comparison',
	'provision-web-server',
	'setup-autonomous-database',
	'setup-private-network'
] as const;
