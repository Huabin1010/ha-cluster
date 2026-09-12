import { useEffect, useState } from "react";

/** 客户端媒体查询。Vite SPA 无 SSR，首帧直接读 matchMedia。 */
export function useMediaQuery(query: string, initial = false) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return initial;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    setMatches(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMd() {
  return useMediaQuery("(min-width: 768px)", true);
}
