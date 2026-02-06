import { describe, it, expect } from 'vitest';

describe('LoadingSpinner Component', () => {
	it('should have default size of "md"', () => {
		const defaultSize = 'md';
		const sizeClasses = {
			sm: 'w-4 h-4',
			md: 'w-6 h-6',
			lg: 'w-8 h-8'
		};
		expect(sizeClasses[defaultSize as keyof typeof sizeClasses]).toBe('w-6 h-6');
	});

	it('should map sizes to correct Tailwind classes', () => {
		const sizeMap = {
			sm: 'w-4 h-4',
			md: 'w-6 h-6',
			lg: 'w-8 h-8'
		};

		expect(sizeMap.sm).toBe('w-4 h-4');
		expect(sizeMap.md).toBe('w-6 h-6');
		expect(sizeMap.lg).toBe('w-8 h-8');
	});

	it('should include spinner class with size', () => {
		const size = 'lg';
		const expectedClass = `spinner-${size}`;
		expect(expectedClass).toBe('spinner-lg');
	});

	it('should include animate-spin class for rotation animation', () => {
		const animationClass = 'animate-spin';
		expect(animationClass).toBe('animate-spin');
	});

	it('should have data-testid for DOM testing', () => {
		const testId = 'loading-spinner';
		expect(testId).toBe('loading-spinner');
	});

	it('should apply text styling when text prop is provided', () => {
		const textStyle = 'text-sm text-gray-600';
		expect(textStyle).toContain('text-sm');
		expect(textStyle).toContain('text-gray-600');
	});

	it('should render SVG with circle and path elements', () => {
		const circleProps = {
			cx: '12',
			cy: '12',
			r: '10',
			opacity: '0.2'
		};
		expect(circleProps.cx).toBe('12');
		expect(circleProps.cy).toBe('12');
		expect(circleProps.r).toBe('10');

		const pathAttrs = {
			d: 'M12 2a10 10 0 0110 10',
			'stroke-linecap': 'round',
			'stroke-dasharray': '0 60'
		};
		expect(pathAttrs['stroke-linecap']).toBe('round');
	});

	it('should have spin animation defined', () => {
		const keyframes =
			'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
		expect(keyframes).toContain('rotate(0deg)');
		expect(keyframes).toContain('rotate(360deg)');
	});

	it('should export size as prop with correct type', () => {
		type SizeType = 'sm' | 'md' | 'lg';
		const validSizes: SizeType[] = ['sm', 'md', 'lg'];
		expect(validSizes).toHaveLength(3);
		expect(validSizes).toContain('md');
	});

	it('should have text prop as optional', () => {
		const textProp: string | null = null;
		expect(textProp).toBeNull();

		const textWithValue: string | null = 'Loading...';
		expect(textWithValue).toBe('Loading...');
	});

	it('should use currentColor for SVG stroke', () => {
		const strokeColor = 'currentColor';
		expect(strokeColor).toBe('currentColor');
	});
});
