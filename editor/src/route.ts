// Hash router: `#/battle`, `#/units`, `#/log`. Switching pages only changes this state, nothing is refetched.
import { useCallback, useEffect, useState } from "react";
import { parseRoute, type Route } from "./store";

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => { window.location.hash = `#/${r}`; }, []);
  return [route, go];
}
