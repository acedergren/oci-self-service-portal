import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCISDK, normalizeSDKResponse, requireCompartmentId } from '../executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const storageTools: ToolEntry[] = [
	{
		name: 'listBuckets',
		description:
			'List Object Storage buckets in a compartment. Present as a table: Name | Created | Public Access | Storage Tier. Flag any buckets with public access as a security concern. Mention that OCI Object Storage includes 10TB/month free egress. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			let namespace = args.namespace as string | undefined;
			if (!namespace) {
				const nsResp = await executeOCISDK('objectStorage', 'getNamespace', {});
				namespace = (nsResp as { value: string }).value;
			}
			const response = await executeOCISDK('objectStorage', 'listBuckets', {
				compartmentId,
				namespaceName: namespace
			});
			return normalizeSDKResponse(response);
		}
	},
	{
		name: 'createBucket',
		description:
			'Create a new Object Storage bucket. ALWAYS default to NoPublicAccess unless user explicitly needs public access. After creation, suggest setting up lifecycle rules for automatic archival and an IAM policy for access control. Mention S3-compatible API access. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)'),
			name: z.string().describe('Name for the bucket'),
			publicAccessType: z.enum(['NoPublicAccess', 'ObjectRead']).default('NoPublicAccess')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			let namespace = args.namespace as string | undefined;
			if (!namespace) {
				const nsResp = await executeOCISDK('objectStorage', 'getNamespace', {});
				namespace = (nsResp as { value: string }).value;
			}
			const response = await executeOCISDK('objectStorage', 'createBucket', {
				namespaceName: namespace,
				createBucketDetails: {
					compartmentId,
					name: args.name as string,
					publicAccessType: (args.publicAccessType as string) || 'NoPublicAccess'
				}
			});
			return normalizeSDKResponse(response);
		}
	},
	{
		name: 'deleteBucket',
		description:
			'Delete an Object Storage bucket. DANGER: Bucket must be empty first. Confirm with user by stating the bucket name. Warn that all objects must be deleted before the bucket can be removed. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'danger',
		parameters: z.object({
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)'),
			bucketName: z.string()
		}),
		executeAsync: async (args) => {
			let namespace = args.namespace as string | undefined;
			if (!namespace) {
				const nsResp = await executeOCISDK('objectStorage', 'getNamespace', {});
				namespace = (nsResp as { value: string }).value;
			}
			const response = await executeOCISDK('objectStorage', 'deleteBucket', {
				namespaceName: namespace,
				bucketName: args.bucketName as string
			});
			return normalizeSDKResponse(response);
		}
	},
	{
		name: 'getObjectStorageNamespace',
		description:
			'Get the Object Storage namespace for the tenancy. This is required before calling listBuckets. Returns a single string (the namespace name). Cache this value — it does not change.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({}),
		executeAsync: async () => {
			const response = await executeOCISDK('objectStorage', 'getNamespace', {});
			// SDK returns { value: "namespace-string" }, normalize to { data: "namespace-string" }
			return { data: (response as { value: string }).value };
		}
	},
	{
		name: 'listContainerRepos',
		description:
			'List Docker image repositories in OCI Container Registry (OCIR). Present as a table: Name | Image Count | Public | Created. Useful for managing container deployments and CI/CD pipelines.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const response = await executeOCISDK('artifacts', 'listContainerRepositories', {
				compartmentId
			});
			return normalizeSDKResponse(response);
		}
	},
	{
		name: 'listContainerImages',
		description:
			'List container images in OCI Container Registry. Filter by repository name or image version. Present as a table: Repository | Version/Tag | Digest | Created | Size.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			repositoryName: z.string().optional().describe('Filter by repository name'),
			imageVersion: z.string().optional().describe('Filter by image version/tag')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const request: Record<string, unknown> = { compartmentId };
			if (args.repositoryName) request.repositoryName = args.repositoryName;
			if (args.imageVersion) request.displayName = args.imageVersion;
			const response = await executeOCISDK('artifacts', 'listContainerImages', request);
			return normalizeSDKResponse(response);
		}
	}
];
