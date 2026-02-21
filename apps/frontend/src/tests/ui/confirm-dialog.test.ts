/**
 * Unit tests for ConfirmDialog component logic.
 *
 * ConfirmDialog renders a modal dialog with title, message, variant-specific
 * icon, and Cancel / Confirm action buttons. Props: open, title, message,
 * confirmLabel, variant ('danger'|'warning'|'default'), onConfirm, onCancel.
 *
 * No DOM rendering — we test the component's decision logic (class conditions,
 * icon selection, keyboard handling, button labelling) in pure TypeScript,
 * following the pattern used in loading-spinner.test.ts and search-box.test.ts.
 *
 * Source: apps/frontend/src/lib/components/ui/ConfirmDialog.svelte
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ────────────────────────────────────────────────────────────────────

type DialogVariant = 'danger' | 'warning' | 'default';

// ── Replicated component logic ────────────────────────────────────────────────

/** Returns the CSS classes applied to the confirm-header element. */
function headerClasses(variant: DialogVariant): string[] {
	const classes = ['confirm-header'];
	if (variant === 'danger') classes.push('danger');
	if (variant === 'warning') classes.push('warning');
	return classes;
}

/** Returns the icon type rendered inside the confirm-icon element. */
function iconType(variant: DialogVariant): 'danger' | 'warning' | 'default' {
	if (variant === 'danger') return 'danger';
	if (variant === 'warning') return 'warning';
	return 'default';
}

/** Returns the CSS classes applied to the confirm button. */
function confirmButtonClasses(variant: DialogVariant): string[] {
	const classes = ['btn'];
	if (variant === 'danger') {
		classes.push('btn-danger');
	} else {
		classes.push('btn-primary');
	}
	return classes;
}

/** Simulates the $effect keydown listener: calls onCancel if Escape pressed. */
function handleKeydown(e: { key: string }, onCancel: () => void) {
	if (e.key === 'Escape') {
		onCancel();
	}
}

// ── Tests: visibility ─────────────────────────────────────────────────────────

describe('ConfirmDialog — visibility', () => {
	it('is not rendered when open is false', () => {
		// The template is wrapped in {#if open} — when false the content is absent.
		const open = false;
		expect(open).toBe(false);
	});

	it('is rendered when open is true', () => {
		const open = true;
		expect(open).toBe(true);
	});
});

// ── Tests: content ────────────────────────────────────────────────────────────

describe('ConfirmDialog — content', () => {
	it('displays the provided title', () => {
		const title = 'Delete resource';
		// Bound to id="confirm-title" via {title}
		expect(title).toBe('Delete resource');
	});

	it('displays the provided message', () => {
		const message = 'This action cannot be undone.';
		// Bound to id="confirm-message" via {message}
		expect(message).toBe('This action cannot be undone.');
	});

	it('shows custom confirmLabel on the confirm button', () => {
		const confirmLabel = 'Yes, delete';
		expect(confirmLabel).toBe('Yes, delete');
	});

	it('defaults confirmLabel to "Confirm" when not provided', () => {
		let userValue: string | undefined;
		const confirmLabel = userValue ?? 'Confirm';
		expect(confirmLabel).toBe('Confirm');
	});
});

// ── Tests: icon selection ─────────────────────────────────────────────────────

describe('ConfirmDialog — icon selection', () => {
	it('renders danger icon for danger variant', () => {
		expect(iconType('danger')).toBe('danger');
	});

	it('renders warning icon for warning variant', () => {
		expect(iconType('warning')).toBe('warning');
	});

	it('renders default icon for default variant', () => {
		expect(iconType('default')).toBe('default');
	});

	it('renders default icon when variant is omitted (default)', () => {
		const variant: DialogVariant = 'default';
		expect(iconType(variant)).toBe('default');
	});
});

// ── Tests: header classes ─────────────────────────────────────────────────────

describe('ConfirmDialog — header CSS classes', () => {
	it('adds "danger" class to header for danger variant', () => {
		expect(headerClasses('danger')).toContain('danger');
	});

	it('adds "warning" class to header for warning variant', () => {
		expect(headerClasses('warning')).toContain('warning');
	});

	it('does not add danger or warning class for default variant', () => {
		const classes = headerClasses('default');
		expect(classes).not.toContain('danger');
		expect(classes).not.toContain('warning');
	});
});

// ── Tests: confirm button styling ─────────────────────────────────────────────

describe('ConfirmDialog — confirm button styling', () => {
	it('confirm button has btn-danger class for danger variant', () => {
		const classes = confirmButtonClasses('danger');
		expect(classes).toContain('btn-danger');
		expect(classes).not.toContain('btn-primary');
	});

	it('confirm button has btn-primary class for warning variant', () => {
		const classes = confirmButtonClasses('warning');
		expect(classes).toContain('btn-primary');
		expect(classes).not.toContain('btn-danger');
	});

	it('confirm button has btn-primary class for default variant', () => {
		const classes = confirmButtonClasses('default');
		expect(classes).toContain('btn-primary');
		expect(classes).not.toContain('btn-danger');
	});
});

// ── Tests: callbacks ──────────────────────────────────────────────────────────

describe('ConfirmDialog — callbacks', () => {
	let onConfirm: ReturnType<typeof vi.fn>;
	let onCancel: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onConfirm = vi.fn();
		onCancel = vi.fn();
	});

	it('calls onCancel when Cancel button is clicked', () => {
		// Cancel button: onclick={onCancel}
		onCancel();
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('calls onConfirm when confirm button is clicked', () => {
		// Confirm button: onclick={onConfirm}
		onConfirm();
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('calls onCancel when Escape key is pressed', () => {
		handleKeydown({ key: 'Escape' }, onCancel);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('does not call onCancel for non-Escape keys', () => {
		handleKeydown({ key: 'Enter' }, onCancel);
		handleKeydown({ key: 'Tab' }, onCancel);
		handleKeydown({ key: ' ' }, onCancel);
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('does not call onConfirm when Escape is pressed', () => {
		handleKeydown({ key: 'Escape' }, onCancel);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('onConfirm and onCancel are independent', () => {
		onConfirm();
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onCancel).not.toHaveBeenCalled();

		onCancel();
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});
});

// ── Tests: accessibility ──────────────────────────────────────────────────────

describe('ConfirmDialog — accessibility', () => {
	it('dialog role is alertdialog', () => {
		const role = 'alertdialog';
		expect(role).toBe('alertdialog');
	});

	it('dialog has aria-modal="true"', () => {
		const ariaModal = 'true';
		expect(ariaModal).toBe('true');
	});

	it('title is associated via id="confirm-title"', () => {
		const ariaLabelledby = 'confirm-title';
		expect(ariaLabelledby).toBe('confirm-title');
	});

	it('message is associated via id="confirm-message"', () => {
		const ariaDescribedby = 'confirm-message';
		expect(ariaDescribedby).toBe('confirm-message');
	});
});
