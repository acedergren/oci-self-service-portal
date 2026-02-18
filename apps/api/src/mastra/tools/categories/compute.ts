import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCI, executeOCIAsync, slimOCIResponse, requireCompartmentId } from '../executor.js';
import {
	executeOCISDK,
	executeAndSlim,
	normalizeSDKResponse,
	camelToKebab
} from '@portal/shared/tools/executor-sdk.js';
import { executeSDKOperation } from '../executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

export const computeTools: ToolEntry[] = [
	{
		name: 'listInstances',
		description:
			'List compute instances in a compartment. Present results as a markdown table: Name | Shape | State | OCPUs | Memory | Created. Highlight any STOPPED instances as potential cost savings (boot volumes still incur charges). Suggest getInstance for details on specific instances, or compareCloudCosts if the user wants to optimize.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			displayName: z.string().optional().describe('Filter by display name'),
			lifecycleState: z.enum(['RUNNING', 'STOPPED', 'TERMINATED']).optional()
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const request: Record<string, unknown> = { compartmentId, limit: 1000 };
			if (args.displayName) request.displayName = args.displayName as string;
			if (args.lifecycleState) request.lifecycleState = args.lifecycleState as string;
			const result = await executeSDKOperation<{ items?: unknown[] }>(
				'compute',
				'listInstances',
				request,
				{ compartmentId }
			);
			if (!result.success) return { error: result.error.message };
			return slimOCIResponse(normalizeSDKResponse(result.data), [
				'display-name',
				'id',
				'lifecycle-state',
				'shape',
				'shape-config',
				'availability-domain',
				'time-created',
				'region',
				'fault-domain'
			]);
		}
	},
	{
		name: 'getInstance',
		description:
			'Get detailed information about a specific compute instance. Present key details: display name, shape, state, OCPU/memory, availability domain, time created, public/private IPs. If the instance is STOPPED, mention that boot volumes still incur cost. Suggest right-sizing if shape seems over-provisioned.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance')
		}),
		executeAsync: async (args) => {
			const instanceId = args.instanceId as string;
			const result = await executeSDKOperation<unknown>(
				'compute',
				'getInstance',
				{ instanceId },
				{ instanceId }
			);
			if (!result.success) return { error: result.error.message };
			return slimOCIResponse(normalizeSDKResponse(result.data), [
				'display-name',
				'id',
				'lifecycle-state',
				'shape',
				'shape-config',
				'availability-domain',
				'time-created',
				'region',
				'fault-domain',
				'source-details',
				'launch-options'
			]);
		}
	},
	{
		name: 'launchInstance',
		description:
			'Launch a new compute instance. REQUIRES user confirmation before calling. Present the planned configuration (shape, OCPUs, memory, image, subnet) in a summary table before launching. After launch, show the instance OCID and suggest checking getInstance for status updates.',
		category: 'compute',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			availabilityDomain: z.string().describe('The availability domain'),
			displayName: z.string().describe('Display name for the instance'),
			shape: z.string().describe('The shape (e.g., VM.Standard.E4.Flex)'),
			imageId: z.string().describe('The OCID of the image'),
			subnetId: z.string().describe('The OCID of the subnet')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const request = {
				launchInstanceDetails: {
					compartmentId,
					availabilityDomain: args.availabilityDomain as string,
					displayName: args.displayName as string,
					shape: args.shape as string,
					sourceDetails: {
						sourceType: 'image',
						imageId: args.imageId as string
					},
					createVnicDetails: {
						subnetId: args.subnetId as string
					}
				}
			};
			const result = await executeSDKOperation<unknown>('compute', 'launchInstance', request, {
				compartmentId
			});
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
		}
	},
	{
		name: 'stopInstance',
		description:
			'Stop a running compute instance. DANGER: Confirm with user first. Warn that boot volume charges continue while stopped. After stopping, suggest terminateInstance if the instance is no longer needed (to save on boot volume costs).',
		category: 'compute',
		approvalLevel: 'danger',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance')
		}),
		executeAsync: async (args) => {
			const instanceId = args.instanceId as string;
			const result = await executeSDKOperation<unknown>(
				'compute',
				'instanceAction',
				{ instanceId, instanceActionDetails: { action: 'STOP' } },
				{ instanceId }
			);
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
		}
	},
	{
		name: 'terminateInstance',
		description:
			'Permanently terminate and delete a compute instance. DANGER: This is irreversible. Always confirm with the user, stating the instance name and OCID. Ask if they want to preserve the boot volume (for data recovery). After termination, confirm the operation completed.',
		category: 'compute',
		approvalLevel: 'danger',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance'),
			preserveBootVolume: z.boolean().default(false)
		}),
		executeAsync: async (args) => {
			const instanceId = args.instanceId as string;
			const preserveBootVolume = args.preserveBootVolume as boolean;
			const request: Record<string, unknown> = { instanceId };
			if (preserveBootVolume) request.preserveBootVolume = true;
			const result = await executeSDKOperation<unknown>('compute', 'terminateInstance', request, {
				instanceId
			});
			if (!result.success) return { error: result.error.message };
			return normalizeSDKResponse(result.data);
		}
	},
	{
		name: 'listAvailabilityDomains',
		description:
			'List availability domains (ADs) in the current region. Present as a simple list with AD names. For production workloads, recommend spreading instances across multiple ADs for high availability. Most regions have 1 AD; large regions (Ashburn, Phoenix, London) have 3.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const response = await executeOCISDK('identity', 'listAvailabilityDomains', {
					compartmentId
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'iam',
					'availability-domain',
					'list',
					'--compartment-id',
					compartmentId
				]);
			}
		}
	},
	{
		name: 'listImages',
		description:
			'List available OS images for compute instances. Present as a table: OS | Version | Shape Compatibility | Created. Recommend Oracle Linux 8 for OCI-optimized performance (kernel tuning, cloud-init). For containers, suggest Oracle Linux with container runtime or Ubuntu 22.04. Filter by shape when a specific shape is already selected.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			operatingSystem: z
				.string()
				.optional()
				.describe('Filter by OS (e.g., "Oracle Linux", "Canonical Ubuntu")'),
			operatingSystemVersion: z
				.string()
				.optional()
				.describe('Filter by OS version (e.g., "8", "22.04")'),
			shape: z.string().optional().describe('Filter by compatible shape')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = {
					compartmentId,
					sortBy: 'TIMECREATED',
					sortOrder: 'DESC',
					limit: 100
				};
				if (args.operatingSystem) request.operatingSystem = args.operatingSystem as string;
				if (args.operatingSystemVersion)
					request.operatingSystemVersion = args.operatingSystemVersion as string;
				if (args.shape) request.shape = args.shape as string;
				return await executeAndSlim('compute', 'listImages', request, [
					'display-name',
					'id',
					'operating-system',
					'operating-system-version',
					'time-created',
					'size-in-mbs',
					'compartment-id'
				]);
			} catch {
				const cliArgs = [
					'compute',
					'image',
					'list',
					'--compartment-id',
					compartmentId,
					'--sort-by',
					'TIMECREATED',
					'--sort-order',
					'DESC',
					'--all'
				];
				if (args.operatingSystem)
					cliArgs.push('--operating-system', args.operatingSystem as string);
				if (args.operatingSystemVersion)
					cliArgs.push('--operating-system-version', args.operatingSystemVersion as string);
				if (args.shape) cliArgs.push('--shape', args.shape as string);
				return slimOCIResponse(executeOCI(cliArgs), [
					'display-name',
					'id',
					'operating-system',
					'operating-system-version',
					'time-created',
					'size-in-mbs',
					'compartment-id'
				]);
			}
		}
	},
	{
		name: 'listShapes',
		description:
			'List available compute shapes with specifications. Present as a comparison table: Shape | Architecture | OCPU Range | Memory Range | Network Bandwidth. Highlight ARM shapes (A1.Flex) as 50%+ cheaper. Bold the recommended shape based on user requirements. If config qualifies for Always Free, call it out prominently.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			availabilityDomain: z.string().optional().describe('Filter by availability domain')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = { compartmentId, limit: 500 };
				if (args.availabilityDomain) request.availabilityDomain = args.availabilityDomain as string;
				return await executeAndSlim('compute', 'listShapes', request, [
					'shape',
					'billing-type',
					'processor-description',
					'ocpus',
					'memory-in-gbs',
					'networking-bandwidth-in-gbps',
					'max-vnic-attachments',
					'gpu-description',
					'ocpu-options',
					'memory-options'
				]);
			} catch {
				const cliArgs = ['compute', 'shape', 'list', '--compartment-id', compartmentId, '--all'];
				if (args.availabilityDomain)
					cliArgs.push('--availability-domain', args.availabilityDomain as string);
				return slimOCIResponse(executeOCI(cliArgs), [
					'shape',
					'billing-type',
					'processor-description',
					'ocpus',
					'memory-in-gbs',
					'networking-bandwidth-in-gbps',
					'max-vnic-attachments',
					'gpu-description',
					'ocpu-options',
					'memory-options'
				]);
			}
		}
	},
	{
		name: 'getInstanceVnics',
		description:
			"Get all network interfaces (VNICs) for a compute instance, including public IP, private IP, subnet, and hostname. This is a composite operation that fetches VNIC attachments and then resolves each VNIC. Useful for finding an instance's IP addresses.",
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance'),
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const instanceId = args.instanceId as string;

			try {
				const attachmentsResponse = await executeOCISDK('compute', 'listVnicAttachments', {
					compartmentId,
					instanceId
				});
				const attachments = normalizeSDKResponse(attachmentsResponse);
				const attachmentList = (
					Array.isArray((attachments as { data: unknown }).data)
						? (attachments as { data: unknown[] }).data
						: []
				) as Array<{
					'vnic-id'?: string;
					vnicId?: string;
					'lifecycle-state'?: string;
					lifecycleState?: string;
				}>;

				if (!attachmentList.length) {
					return { vnics: [], message: 'No VNIC attachments found for this instance' };
				}

				const vnics = await Promise.all(
					attachmentList
						.filter((a) => (a['lifecycle-state'] ?? a.lifecycleState) === 'ATTACHED')
						.map(async (attachment) => {
							const vnicId = (attachment['vnic-id'] ?? attachment.vnicId) as string;
							try {
								const vnicResponse = await executeOCISDK('virtualNetwork', 'getVnic', { vnicId });
								const vnicData = normalizeSDKResponse(vnicResponse);
								return { vnicId, ...(vnicData as { data: Record<string, unknown> }).data };
							} catch {
								return { vnicId, error: 'Failed to resolve VNIC' };
							}
						})
				);

				return { vnics, count: vnics.length };
			} catch {
				// Full CLI fallback for the composite operation
				const attachments = (await executeOCIAsync([
					'compute',
					'vnic-attachment',
					'list',
					'--instance-id',
					instanceId,
					'--compartment-id',
					compartmentId,
					'--all'
				])) as {
					data: Array<{
						'vnic-id': string;
						'display-name'?: string;
						'lifecycle-state': string;
					}>;
				};

				if (!attachments?.data?.length) {
					return { vnics: [], message: 'No VNIC attachments found for this instance' };
				}

				const vnics = await Promise.all(
					attachments.data
						.filter((a) => a['lifecycle-state'] === 'ATTACHED')
						.map(async (attachment) => {
							try {
								const vnic = (await executeOCIAsync([
									'network',
									'vnic',
									'get',
									'--vnic-id',
									attachment['vnic-id']
								])) as { data: Record<string, unknown> };
								return { vnicId: attachment['vnic-id'], ...vnic.data };
							} catch {
								return { vnicId: attachment['vnic-id'], error: 'Failed to resolve VNIC' };
							}
						})
				);

				return { vnics, count: vnics.length };
			}
		}
	},
	{
		name: 'runInstanceCommand',
		description:
			'Execute a script on a remote compute instance via OCI Instance Agent. REQUIRES user confirmation. The command runs as root on the target instance. Use for diagnostics, log collection, or configuration tasks. Check getCommandExecution for results.',
		category: 'compute',
		approvalLevel: 'confirm',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the target instance'),
			command: z.string().describe('The shell script/command to execute'),
			timeoutSeconds: z.number().default(60).describe('Execution timeout in seconds'),
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const instanceId = args.instanceId as string;
			const command = args.command as string;
			const timeoutSeconds = (args.timeoutSeconds as number) || 60;

			try {
				const request = {
					createInstanceAgentCommandDetails: {
						compartmentId,
						executionTimeOutInSeconds: timeoutSeconds,
						target: { instanceId },
						content: {
							source: { sourceType: 'TEXT', text: command }
						}
					}
				};
				const response = await executeOCISDK(
					'computeInstanceAgent',
					'createInstanceAgentCommand',
					request
				);
				const result = normalizeSDKResponse(response);
				return {
					instanceId,
					command,
					timeoutSeconds,
					data: result,
					note: 'Use getCommandExecution to check the result'
				};
			} catch {
				const commandDetails = JSON.stringify({
					source: { sourceType: 'TEXT', text: command },
					executionTimeOutInSeconds: timeoutSeconds,
					target: { instanceId },
					compartmentId
				});
				const result = await executeOCIAsync([
					'instance-agent',
					'command',
					'create',
					'--from-json',
					commandDetails
				]);
				return {
					instanceId,
					command,
					timeoutSeconds,
					data: result,
					note: 'Use getCommandExecution to check the result'
				};
			}
		}
	},
	{
		name: 'getCommandExecution',
		description:
			'Check the result of a remote command executed via runInstanceCommand. Returns the command output (stdout/stderr), exit code, and execution status.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance'),
			commandId: z.string().describe('The OCID of the command to check')
		}),
		executeAsync: async (args) => {
			const instanceId = args.instanceId as string;
			const instanceAgentCommandId = args.commandId as string;
			try {
				const response = await executeOCISDK(
					'computeInstanceAgent',
					'getInstanceAgentCommandExecution',
					{ instanceId, instanceAgentCommandId }
				);
				return normalizeSDKResponse(response);
			} catch {
				return executeOCI([
					'instance-agent',
					'command-execution',
					'get',
					'--instance-agent-command-id',
					instanceAgentCommandId,
					'--instance-id',
					instanceId
				]);
			}
		}
	},
	{
		name: 'listInstancePlugins',
		description:
			'Check the status of Oracle Cloud Agent (OCA) plugins on a compute instance. Shows which plugins are running (Monitoring, OS Management, Bastion, etc.). Useful for diagnosing missing metrics or agent connectivity.',
		category: 'compute',
		approvalLevel: 'auto',
		parameters: z.object({
			instanceId: z.string().describe('The OCID of the instance'),
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const instanceagentId = args.instanceId as string;
			try {
				const response = await executeOCISDK('instanceAgentPlugin', 'listInstanceAgentPlugins', {
					instanceagentId,
					compartmentId
				});
				const normalized = normalizeSDKResponse(response);
				return camelToKebab(normalized);
			} catch {
				return executeOCI([
					'instance-agent',
					'plugin',
					'list',
					'--instanceagent-id',
					instanceagentId,
					'--compartment-id',
					compartmentId
				]);
			}
		}
	}
];
