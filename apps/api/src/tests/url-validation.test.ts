import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidExternalUrl } from '@portal/server/url-validation';
import { promises as dns } from 'dns';

vi.mock('dns', () => ({
	promises: {
		resolve4: vi.fn(),
		resolve6: vi.fn()
	}
}));

const mockDns = dns as {
	resolve4: ReturnType<typeof vi.fn>;
	resolve6: ReturnType<typeof vi.fn>;
};

describe('isValidExternalUrl - SSRF Protection', () => {
	beforeEach(() => {
		mockDns.resolve4.mockReset();
		mockDns.resolve6.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects non-HTTPS URLs', async () => {
		expect(await isValidExternalUrl('http://example.com')).toBe(false);
		expect(await isValidExternalUrl('ftp://example.com')).toBe(false);
	});

	it('rejects localhost and loopback addresses', async () => {
		expect(await isValidExternalUrl('https://localhost')).toBe(false);
		expect(await isValidExternalUrl('https://127.0.0.1')).toBe(false);
		expect(await isValidExternalUrl('https://[::1]')).toBe(false);
	});

	it('rejects internal hostnames', async () => {
		expect(await isValidExternalUrl('https://api.internal')).toBe(false);
		expect(await isValidExternalUrl('https://database.internal')).toBe(false);
	});

	it('rejects private IPv4 literals', async () => {
		expect(await isValidExternalUrl('https://10.0.0.1')).toBe(false);
		expect(await isValidExternalUrl('https://192.168.1.1')).toBe(false);
		expect(await isValidExternalUrl('https://172.16.0.1')).toBe(false);
	});

	it('rejects link-local IPv4 (cloud metadata)', async () => {
		expect(await isValidExternalUrl('https://169.254.169.254')).toBe(false);
	});

	it('rejects private IPv6 literals', async () => {
		expect(await isValidExternalUrl('https://[fc00::1]')).toBe(false);
		expect(await isValidExternalUrl('https://[fd00::1]')).toBe(false);
		expect(await isValidExternalUrl('https://[fe80::1]')).toBe(false);
	});

	describe('DNS Rebinding Protection', () => {
		it('rejects hostnames that resolve to private IPv4', async () => {
			// evil.com resolves to 192.168.1.100 (private)
			mockDns.resolve4.mockResolvedValue(['192.168.1.100']);
			mockDns.resolve6.mockRejectedValue(new Error('No IPv6'));

			expect(await isValidExternalUrl('https://evil.com')).toBe(false);
		});

		it('rejects hostnames that resolve to loopback', async () => {
			// attacker.com resolves to 127.0.0.1
			mockDns.resolve4.mockResolvedValue(['127.0.0.1']);
			mockDns.resolve6.mockRejectedValue(new Error('No IPv6'));

			expect(await isValidExternalUrl('https://attacker.com')).toBe(false);
		});

		it('rejects hostnames that resolve to link-local (cloud metadata)', async () => {
			// metadata.attacker.com resolves to 169.254.169.254
			mockDns.resolve4.mockResolvedValue(['169.254.169.254']);
			mockDns.resolve6.mockRejectedValue(new Error('No IPv6'));

			expect(await isValidExternalUrl('https://metadata.attacker.com')).toBe(false);
		});

		it('rejects if ANY resolved IP is private', async () => {
			// Multi-homed host: one public, one private
			mockDns.resolve4.mockResolvedValue(['8.8.8.8', '192.168.1.1']);
			mockDns.resolve6.mockRejectedValue(new Error('No IPv6'));

			expect(await isValidExternalUrl('https://multi.example.com')).toBe(false);
		});

		it('rejects hostnames that fail DNS resolution', async () => {
			mockDns.resolve4.mockRejectedValue(new Error('NXDOMAIN'));
			mockDns.resolve6.mockRejectedValue(new Error('NXDOMAIN'));

			expect(await isValidExternalUrl('https://does-not-exist.example')).toBe(false);
		});

		it('rejects hostnames with no resolved addresses', async () => {
			// DNS succeeds but returns empty arrays (weird edge case)
			mockDns.resolve4.mockResolvedValue([]);
			mockDns.resolve6.mockResolvedValue([]);

			expect(await isValidExternalUrl('https://empty.example.com')).toBe(false);
		});

		it('allows hostnames that resolve to public IPv4 only', async () => {
			// example.com resolves to 93.184.216.34 (public)
			mockDns.resolve4.mockResolvedValue(['93.184.216.34']);
			mockDns.resolve6.mockRejectedValue(new Error('No IPv6'));

			expect(await isValidExternalUrl('https://example.com')).toBe(true);
		});

		it('allows hostnames that resolve to public IPv6', async () => {
			// example.com resolves to 2606:2800:220:1:248:1893:25c8:1946 (public)
			mockDns.resolve4.mockRejectedValue(new Error('No IPv4'));
			mockDns.resolve6.mockResolvedValue(['2606:2800:220:1:248:1893:25c8:1946']);

			expect(await isValidExternalUrl('https://example.com')).toBe(true);
		});

		it('allows hostnames that resolve to both public IPv4 and IPv6', async () => {
			mockDns.resolve4.mockResolvedValue(['93.184.216.34']);
			mockDns.resolve6.mockResolvedValue(['2606:2800:220:1:248:1893:25c8:1946']);

			expect(await isValidExternalUrl('https://example.com')).toBe(true);
		});

		it('allows IPv4 address if already public literal', async () => {
			// When hostname is already an IP literal, DNS resolution is skipped
			expect(await isValidExternalUrl('https://8.8.8.8')).toBe(true);

			// DNS resolution should not have been called for IP literals
			expect(mockDns.resolve4).not.toHaveBeenCalled();
			expect(mockDns.resolve6).not.toHaveBeenCalled();
		});
	});
});
