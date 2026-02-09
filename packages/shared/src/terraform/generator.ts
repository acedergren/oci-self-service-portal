/**
 * Terraform Code Generator for OCI Resources
 *
 * Generates HashiCorp Configuration Language (HCL) code for common OCI patterns.
 * Based on patterns from ~/.agents/skills/infrastructure-as-code/
 */

/**
 * Configuration for compute instance Terraform generation
 */
export interface ComputeConfig {
	displayName: string;
	shape: string;
	ocpus?: number;
	memoryGBs?: number;
	imageId?: string;
	subnetId?: string;
	availabilityDomain?: string;
	compartmentId?: string;
	sshPublicKey?: string;
	preserveBootVolume?: boolean;
	/** Freeform tags */
	tags?: Record<string, string>;
}

/**
 * Configuration for VCN Terraform generation
 */
export interface VcnConfig {
	displayName: string;
	cidrBlock: string;
	compartmentId?: string;
	dnsLabel?: string;
	createInternetGateway?: boolean;
	createNatGateway?: boolean;
	createServiceGateway?: boolean;
	tags?: Record<string, string>;
}

/**
 * Configuration for subnet Terraform generation
 */
export interface SubnetConfig {
	displayName: string;
	cidrBlock: string;
	vcnId?: string;
	compartmentId?: string;
	dnsLabel?: string;
	isPublic?: boolean;
	tags?: Record<string, string>;
}

/**
 * Combined Terraform configuration
 */
export interface TerraformConfig {
	compute?: ComputeConfig;
	vcn?: VcnConfig;
	subnets?: SubnetConfig[];
	/** Provider configuration */
	provider?: {
		region?: string;
		tenancyOcid?: string;
		userOcid?: string;
		authMethod?: 'config_file' | 'instance_principal' | 'api_key';
	};
	/** Variable definitions instead of hardcoded values */
	useVariables?: boolean;
}

/**
 * Generated Terraform output
 */
export interface TerraformOutput {
	/** Main Terraform configuration */
	main: string;
	/** Variables file content */
	variables?: string;
	/** Outputs file content */
	outputs?: string;
	/** Example tfvars file */
	tfvars?: string;
}

/**
 * Generate provider block
 */
function generateProviderBlock(config: TerraformConfig['provider'], useVariables: boolean): string {
	if (config?.authMethod === 'instance_principal') {
		return `provider "oci" {
  auth   = "InstancePrincipal"
  region = ${useVariables ? 'var.region' : `"${config.region || 'eu-frankfurt-1'}"`}
}`;
	}

	return `provider "oci" {
  tenancy_ocid     = ${useVariables ? 'var.tenancy_ocid' : `"${config?.tenancyOcid || '<tenancy-ocid>'}"`}
  user_ocid        = ${useVariables ? 'var.user_ocid' : `"${config?.userOcid || '<user-ocid>'}"`}
  private_key_path = ${useVariables ? 'var.private_key_path' : '"~/.oci/oci_api_key.pem"'}
  fingerprint      = ${useVariables ? 'var.fingerprint' : '"<fingerprint>"'}
  region           = ${useVariables ? 'var.region' : `"${config?.region || 'eu-frankfurt-1'}"`}
}`;
}

/**
 * Generate VCN resources
 */
function generateVcnResources(config: VcnConfig, useVariables: boolean): string {
	const compartmentRef = useVariables
		? 'var.compartment_id'
		: `"${config.compartmentId || '<compartment-ocid>'}"`;
	const prefix = config.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');

	let hcl = `# Virtual Cloud Network
resource "oci_core_vcn" "${prefix}" {
  compartment_id = ${compartmentRef}
  cidr_blocks    = ["${config.cidrBlock}"]
  display_name   = "${config.displayName}"
  ${config.dnsLabel ? `dns_label      = "${config.dnsLabel}"` : ''}
  ${generateTagsBlock(config.tags)}
}`;

	if (config.createInternetGateway) {
		hcl += `

# Internet Gateway for public access
resource "oci_core_internet_gateway" "${prefix}_igw" {
  compartment_id = ${compartmentRef}
  vcn_id         = oci_core_vcn.${prefix}.id
  display_name   = "${config.displayName}-igw"
  enabled        = true
}

# Route table for public subnet
resource "oci_core_route_table" "${prefix}_public_rt" {
  compartment_id = ${compartmentRef}
  vcn_id         = oci_core_vcn.${prefix}.id
  display_name   = "${config.displayName}-public-rt"

  route_rules {
    network_entity_id = oci_core_internet_gateway.${prefix}_igw.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}`;
	}

	if (config.createNatGateway) {
		hcl += `

# NAT Gateway for private subnet outbound access
resource "oci_core_nat_gateway" "${prefix}_natgw" {
  compartment_id = ${compartmentRef}
  vcn_id         = oci_core_vcn.${prefix}.id
  display_name   = "${config.displayName}-natgw"
}

# Route table for private subnet
resource "oci_core_route_table" "${prefix}_private_rt" {
  compartment_id = ${compartmentRef}
  vcn_id         = oci_core_vcn.${prefix}.id
  display_name   = "${config.displayName}-private-rt"

  route_rules {
    network_entity_id = oci_core_nat_gateway.${prefix}_natgw.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}`;
	}

	if (config.createServiceGateway) {
		hcl += `

# Service Gateway for OCI services access (free egress)
data "oci_core_services" "all_services" {
  filter {
    name   = "name"
    values = ["All .* Services In Oracle Services Network"]
    regex  = true
  }
}

resource "oci_core_service_gateway" "${prefix}_sgw" {
  compartment_id = ${compartmentRef}
  vcn_id         = oci_core_vcn.${prefix}.id
  display_name   = "${config.displayName}-sgw"

  services {
    service_id = data.oci_core_services.all_services.services[0].id
  }
}`;
	}

	return hcl;
}

/**
 * Generate subnet resources
 */
function generateSubnetResources(
	config: SubnetConfig,
	vcnPrefix: string,
	useVariables: boolean
): string {
	const compartmentRef = useVariables
		? 'var.compartment_id'
		: `"${config.compartmentId || '<compartment-ocid>'}"`;
	const prefix = config.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
	const routeTableRef = config.isPublic
		? `oci_core_route_table.${vcnPrefix}_public_rt.id`
		: `oci_core_route_table.${vcnPrefix}_private_rt.id`;

	return `
# ${config.isPublic ? 'Public' : 'Private'} Subnet
resource "oci_core_subnet" "${prefix}" {
  compartment_id             = ${compartmentRef}
  vcn_id                     = oci_core_vcn.${vcnPrefix}.id
  cidr_block                 = "${config.cidrBlock}"
  display_name               = "${config.displayName}"
  ${config.dnsLabel ? `dns_label                  = "${config.dnsLabel}"` : ''}
  prohibit_public_ip_on_vnic = ${config.isPublic ? 'false' : 'true'}
  route_table_id             = ${routeTableRef}
  ${generateTagsBlock(config.tags)}
}`;
}

/**
 * Generate compute instance resources
 */
function generateComputeResources(config: ComputeConfig, useVariables: boolean): string {
	const compartmentRef = useVariables
		? 'var.compartment_id'
		: `"${config.compartmentId || '<compartment-ocid>'}"`;
	const prefix = config.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
	const isFlexShape = config.shape.includes('Flex');

	let hcl = `# Data source to get availability domains
data "oci_identity_availability_domains" "ads" {
  compartment_id = ${useVariables ? 'var.tenancy_ocid' : compartmentRef}
}

# Data source to get latest Oracle Linux image
data "oci_core_images" "oracle_linux" {
  compartment_id           = ${compartmentRef}
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = "${config.shape}"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# Compute Instance
resource "oci_core_instance" "${prefix}" {
  compartment_id      = ${compartmentRef}
  availability_domain = ${
		config.availabilityDomain
			? `"${config.availabilityDomain}"`
			: 'data.oci_identity_availability_domains.ads.availability_domains[0].name'
	}
  shape               = "${config.shape}"
  display_name        = "${config.displayName}"
  preserve_boot_volume = ${config.preserveBootVolume ?? false}
`;

	if (isFlexShape) {
		hcl += `
  shape_config {
    ocpus         = ${config.ocpus || 1}
    memory_in_gbs = ${config.memoryGBs || 6}
  }
`;
	}

	hcl += `
  create_vnic_details {
    subnet_id        = ${config.subnetId ? `"${config.subnetId}"` : useVariables ? 'var.subnet_id' : '"<subnet-ocid>"'}
    assign_public_ip = true
  }

  source_details {
    source_type = "image"
    source_id   = ${config.imageId ? `"${config.imageId}"` : 'data.oci_core_images.oracle_linux.images[0].id'}
  }

  metadata = {
    ssh_authorized_keys = ${config.sshPublicKey ? `"${config.sshPublicKey}"` : useVariables ? 'var.ssh_public_key' : 'file("~/.ssh/id_rsa.pub")'}
  }

  ${generateTagsBlock(config.tags)}
}`;

	return hcl;
}

/**
 * Generate tags block
 */
function generateTagsBlock(tags?: Record<string, string>): string {
	if (!tags || Object.keys(tags).length === 0) {
		return '';
	}

	const tagsStr = Object.entries(tags)
		.map(([k, v]) => `    "${k}" = "${v}"`)
		.join('\n');

	return `freeform_tags = {
${tagsStr}
  }`;
}

/**
 * Generate variables.tf content
 */
function generateVariables(config: TerraformConfig): string {
	let vars = `# Variables for OCI Terraform configuration

variable "tenancy_ocid" {
  description = "The OCID of the tenancy"
  type        = string
}

variable "user_ocid" {
  description = "The OCID of the user"
  type        = string
  default     = ""
}

variable "private_key_path" {
  description = "Path to the private key file"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "fingerprint" {
  description = "Fingerprint of the API key"
  type        = string
  default     = ""
}

variable "region" {
  description = "OCI region"
  type        = string
  default     = "${config.provider?.region || 'eu-frankfurt-1'}"
}

variable "compartment_id" {
  description = "The OCID of the compartment"
  type        = string
}
`;

	if (config.compute) {
		vars += `
variable "subnet_id" {
  description = "The OCID of the subnet for the instance"
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "SSH public key for instance access"
  type        = string
  default     = ""
}
`;
	}

	return vars;
}

/**
 * Generate outputs.tf content
 */
function generateOutputs(config: TerraformConfig): string {
	let outputs = `# Outputs for OCI Terraform configuration\n`;

	if (config.vcn) {
		const prefix = config.vcn.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
		outputs += `
output "vcn_id" {
  description = "The OCID of the VCN"
  value       = oci_core_vcn.${prefix}.id
}

output "vcn_cidr" {
  description = "The CIDR block of the VCN"
  value       = oci_core_vcn.${prefix}.cidr_blocks[0]
}
`;
	}

	if (config.compute) {
		const prefix = config.compute.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
		outputs += `
output "instance_id" {
  description = "The OCID of the compute instance"
  value       = oci_core_instance.${prefix}.id
}

output "instance_public_ip" {
  description = "The public IP of the instance"
  value       = oci_core_instance.${prefix}.public_ip
}

output "instance_private_ip" {
  description = "The private IP of the instance"
  value       = oci_core_instance.${prefix}.private_ip
}
`;
	}

	return outputs;
}

/**
 * Generate example terraform.tfvars content
 */
function generateTfvars(config: TerraformConfig): string {
	return `# Example terraform.tfvars
# Copy this file and fill in your values

tenancy_ocid     = "<your-tenancy-ocid>"
user_ocid        = "<your-user-ocid>"
fingerprint      = "<your-api-key-fingerprint>"
private_key_path = "~/.oci/oci_api_key.pem"
region           = "${config.provider?.region || 'eu-frankfurt-1'}"
compartment_id   = "<your-compartment-ocid>"
${
	config.compute
		? `subnet_id        = "<your-subnet-ocid>"
ssh_public_key   = "<your-ssh-public-key>"`
		: ''
}
`;
}

/**
 * Generate complete Terraform code from configuration
 */
export function generateTerraformCode(config: TerraformConfig): TerraformOutput {
	const useVariables = config.useVariables ?? true;
	const parts: string[] = [];

	// Terraform block
	parts.push(`terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}
`);

	// Provider
	parts.push(generateProviderBlock(config.provider, useVariables));

	// VCN
	if (config.vcn) {
		parts.push(generateVcnResources(config.vcn, useVariables));

		// Subnets
		if (config.subnets) {
			const vcnPrefix = config.vcn.displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
			for (const subnet of config.subnets) {
				parts.push(generateSubnetResources(subnet, vcnPrefix, useVariables));
			}
		}
	}

	// Compute
	if (config.compute) {
		parts.push(generateComputeResources(config.compute, useVariables));
	}

	const output: TerraformOutput = {
		main: parts.join('\n\n')
	};

	if (useVariables) {
		output.variables = generateVariables(config);
		output.outputs = generateOutputs(config);
		output.tfvars = generateTfvars(config);
	}

	return output;
}

/**
 * Generate a quick compute instance Terraform snippet
 */
export function generateQuickComputeTerraform(options: {
	name: string;
	shape: string;
	ocpus?: number;
	memoryGBs?: number;
	region?: string;
}): string {
	const config: TerraformConfig = {
		useVariables: true,
		provider: { region: options.region || 'eu-frankfurt-1' },
		compute: {
			displayName: options.name,
			shape: options.shape,
			ocpus: options.ocpus,
			memoryGBs: options.memoryGBs,
			tags: {
				ManagedBy: 'Terraform',
				CreatedBy: 'oci-ai-chat'
			}
		}
	};

	return generateTerraformCode(config).main;
}

/**
 * Generate a full web server infrastructure Terraform
 */
export function generateWebServerTerraform(options: {
	name: string;
	shape: string;
	ocpus?: number;
	memoryGBs?: number;
	region?: string;
	vcnCidr?: string;
}): TerraformOutput {
	const baseName = options.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
	const vcnCidr = options.vcnCidr || '10.0.0.0/16';

	const config: TerraformConfig = {
		useVariables: true,
		provider: { region: options.region || 'eu-frankfurt-1' },
		vcn: {
			displayName: `${baseName}-vcn`,
			cidrBlock: vcnCidr,
			dnsLabel: baseName.substring(0, 15),
			createInternetGateway: true,
			createNatGateway: true,
			createServiceGateway: true,
			tags: {
				ManagedBy: 'Terraform',
				Environment: 'production'
			}
		},
		subnets: [
			{
				displayName: `${baseName}-public-subnet`,
				cidrBlock: vcnCidr.replace('/16', '/24').replace('.0.0/', '.0.'),
				dnsLabel: 'public',
				isPublic: true
			},
			{
				displayName: `${baseName}-private-subnet`,
				cidrBlock: vcnCidr.replace('/16', '/24').replace('.0.0/', '.1.'),
				dnsLabel: 'private',
				isPublic: false
			}
		],
		compute: {
			displayName: options.name,
			shape: options.shape,
			ocpus: options.ocpus || 1,
			memoryGBs: options.memoryGBs || 6,
			preserveBootVolume: false,
			tags: {
				ManagedBy: 'Terraform',
				Component: 'WebServer'
			}
		}
	};

	return generateTerraformCode(config);
}
