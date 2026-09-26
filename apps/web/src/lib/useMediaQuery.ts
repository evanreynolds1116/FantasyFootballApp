import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** UI.md: laptop layout at >= 1024px; below that (down through phone) uses the one-column layout. */
export function useIsLaptop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
