// Dismiss behaviour shared by every transient overlay (menus, modals).
// Previously each dropdown stayed open until its own trigger was clicked again —
// clicking elsewhere on the page left a stale menu floating.

/**
 * Close when a pointer lands outside the node, or when Escape is pressed.
 * Usage: <div use:dismissable={onClose}>
 */
export function dismissable(node, onClose) {
  let close = onClose;

  function onPointerDown(e) {
    if (!node.contains(e.target)) close?.();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close?.();
    }
  }

  // `capture` so we still see the event if an inner handler stops propagation.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown);

  return {
    update(next) {
      close = next;
    },
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown);
    }
  };
}

/**
 * Keep Tab focus inside a dialog and hand focus back to whatever opened it.
 * Usage: <div use:focusTrap>
 */
export function focusTrap(node) {
  const previous = document.activeElement;
  const SELECTOR =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  function focusables() {
    return [...node.querySelectorAll(SELECTOR)].filter((el) => el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKeydown);
  // Focus the dialog itself rather than its first control, so screen readers
  // announce the dialog label before its contents.
  queueMicrotask(() => (focusables()[0] || node).focus());

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      if (previous instanceof HTMLElement) previous.focus();
    }
  };
}

/** Prevent the page behind a modal from scrolling while it is open. */
export function lockScroll() {
  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = prev;
  };
}
