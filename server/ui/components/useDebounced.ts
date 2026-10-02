import { useEffect, useState } from 'react';

/**
 * A value that settles: the operator types, and the call goes out once they
 * stop. The console searches on every keystroke otherwise, and a server on a
 * LAN answers a query in milliseconds - which is exactly how a search box ends
 * up firing a request per character.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
