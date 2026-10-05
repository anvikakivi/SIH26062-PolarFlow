import { useEffect, useReducer } from "react";

// Re-render when an external store (AppRoutes / AppLocations / ...) changes.
// `subscribe(fn)` must return an unsubscribe function.
export function useStore(subscribe) {
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribe(() => tick()), [subscribe]);
}
