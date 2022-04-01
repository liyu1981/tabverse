import React from 'react';

/**
 * Returns true if `node` is null/undefined, false, empty string, or an array
 * composed of those. If `node` is an array, only one level of the array is
 * checked, for performance reasons.
 */
export function isReactNodeEmpty(
  node?: React.ReactNode,
  skipArray = false,
): boolean {
  return (
    node == null ||
    node === '' ||
    node === false ||
    (!skipArray &&
      Array.isArray(node) &&
      // only recurse one level through arrays, for performance
      (node.length === 0 || node.every((n) => isReactNodeEmpty(n, true))))
  );
}
