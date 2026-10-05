import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'league'; slug: string; tab: 'table' | 'titles' | 'export' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'league' && parts[1]) {
    const tab = parts[2] === 'titles' || parts[2] === 'export' ? parts[2] : 'table';
    return { name: 'league', slug: parts[1], tab };
  }
  return { name: 'home' };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const href = {
  home: () => '#/',
  league: (slug: string, tab?: 'table' | 'titles' | 'export') => `#/league/${slug}${tab && tab !== 'table' ? `/${tab}` : ''}`,
};
