/**
 * Copying, on a server that is usually on a LAN.
 *
 * `navigator.clipboard.writeText` only exists in a secure context, and a secure
 * context is exactly what a self-hosted server on a LAN does not have: the
 * console is routinely opened at http://192.168.0.221:8223, where
 * `navigator.clipboard` is undefined. So this tries the modern API, falls back
 * to `execCommand('copy')` on a throwaway textarea, and reports failure - a copy
 * button that silently does nothing is worse than no button.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through: permission denied, or the document is not focused
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(scratch);
    if (copied) return true;
  } catch {
    // fall through to the caller's own fallback
  }
  return false;
}

/** Selects a node's text, so a refused copy can still be pasted with Ctrl+C. */
export function selectText(node: Node | null): void {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
