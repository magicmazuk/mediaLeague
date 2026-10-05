import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Tried in order; null/empty entries are skipped. */
  sources: (string | null | undefined)[];
  fallback?: ReactNode;
}

/** An <img> that walks a list of sources and renders `fallback` if they all fail. */
export function Img({ sources, fallback = null, alt = '', ...rest }: Props) {
  const list = sources.filter((s): s is string => !!s);
  const key = list.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [key]);
  if (index >= list.length) return <>{fallback}</>;
  return <img key={list[index]} src={list[index]} alt={alt} onError={() => setIndex((i) => i + 1)} {...rest} />;
}
