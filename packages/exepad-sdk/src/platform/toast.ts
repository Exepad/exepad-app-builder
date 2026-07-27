/**
 * Toast bridge — dispatches `exepad:toast` custom events that the runtime's
 * ToastEventListener picks up and renders via the shadcn/radix Toaster.
 *
 * Generated components call `toast.success(msg)`, `toast.error(msg)`, etc.
 * Sonner is NOT mounted in the runtime, so we bridge to the event system.
 */

interface ToastOptions {
  description?: string;
  duration?: number;
}

function dispatchToast(
  message: string,
  type: string = 'default',
  opts?: ToastOptions,
) {
  const detail = {
    message: opts?.description ? `${message} — ${opts.description}` : message,
    type,
    duration: opts?.duration ?? 5000,
  };
  // The SDK ships into generated apps that may evaluate it during SSR or in a
  // non-DOM worker; degrade to a no-op instead of throwing when there is no
  // window to dispatch on.
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new CustomEvent('exepad:toast', { detail }));
}

function toast(message: string, opts?: ToastOptions) {
  dispatchToast(message, 'default', opts);
}

toast.success = (message: string, opts?: ToastOptions) =>
  dispatchToast(message, 'success', opts);

toast.error = (message: string, opts?: ToastOptions) =>
  dispatchToast(message, 'error', opts);

toast.warning = (message: string, opts?: ToastOptions) =>
  dispatchToast(message, 'warning', opts);

toast.info = (message: string, opts?: ToastOptions) =>
  dispatchToast(message, 'info', opts);

export { toast };
