declare module 'ipaddr.js' {
	export type IPv4Range =
		| 'unspecified'
		| 'broadcast'
		| 'multicast'
		| 'linkLocal'
		| 'loopback'
		| 'carrierGradeNat'
		| 'private'
		| 'reserved'
		| 'benchmarking'
		| 'amt'
		| 'as112'
		| 'unicast';

	export type IPv6Range =
		| 'unspecified'
		| 'multicast'
		| 'linkLocal'
		| 'loopback'
		| 'reserved'
		| 'benchmarking'
		| 'amt'
		| 'uniqueLocal'
		| 'ipv4Mapped'
		| 'rfc6145'
		| 'rfc6052'
		| '6to4'
		| 'teredo'
		| 'as112v6'
		| 'orchid2'
		| 'droneRemoteIdProtocolEntityTags'
		| 'unicast';

	export interface IPv4 {
		kind(): 'ipv4';
		toString(): string;
		range(): IPv4Range;
	}

	export interface IPv6 {
		kind(): 'ipv6';
		toString(): string;
		range(): IPv6Range;
	}

	export type IPAddress = IPv4 | IPv6;

	export function isValid(input: string): boolean;
	export function parse(input: string): IPAddress;

	const _default: {
		isValid: typeof isValid;
		parse: typeof parse;
	};

	export default _default;
}
