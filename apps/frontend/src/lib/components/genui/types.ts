/**
 * GenUI component types — structured data shapes for AI-rendered UI.
 *
 * Each type represents a data payload that an AI tool call can return,
 * which gets rendered as an interactive component in the chat stream.
 */

/** OCI compute instance row for InstanceTable */
export interface InstanceRow {
	id: string;
	displayName: string;
	shape: string;
	lifecycleState: 'RUNNING' | 'STOPPED' | 'TERMINATED' | 'PROVISIONING' | 'STARTING' | 'STOPPING';
	availabilityDomain?: string;
	timeCreated?: string;
	region?: string;
	faultDomain?: string;
	shapeConfig?: {
		ocpus?: number;
		memoryInGBs?: number;
	};
}

/** Generic resource item for ResourceList */
export interface ResourceItem {
	id: string;
	name: string;
	type: string;
	status: 'active' | 'inactive' | 'warning' | 'error' | 'pending' | 'terminated';
	description?: string;
	metadata?: Record<string, string | number | boolean>;
	timeCreated?: string;
}

/** Sort direction for table columns */
export type SortDirection = 'asc' | 'desc' | false;

/** Column sort state */
export interface SortState {
	id: string;
	desc: boolean;
}
