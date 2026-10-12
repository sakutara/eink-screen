import { useEffect, useState } from 'preact/hooks';

export function useHashRoute(): string {
  const read = () => location.hash.replace(/^#/, '') || '/devices';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
