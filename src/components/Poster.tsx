import { useState, type ImgHTMLAttributes } from 'react';

interface Props {
  src: string | null | undefined;
  className?: string;
  alt?: string;
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  /** Shown if the image is missing or fails to load. */
  fallbackText?: string;
}

/**
 * Poster art in a 2:3 frame. Most posters fill it; odd shapes (wide N64 and SNES
 * boxes, square album-style covers) are shown whole over a blurred fill instead
 * of being cropped.
 */
export function Poster({ src, className = '', alt = '', loading, fallbackText = '' }: Props) {
  const [odd, setOdd] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!src || failed === src) return <span className={`poster-fallback ${className}`}>{fallbackText}</span>;
  return (
    <span className={`poster${odd ? ' is-odd' : ''} ${className}`}>
      {odd && <img className="poster-fill" src={src} alt="" aria-hidden="true" />}
      <img
        className="poster-img"
        src={src}
        alt={alt}
        loading={loading}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          setOdd(h > 0 && Math.abs(w / h - 2 / 3) > 0.1);
        }}
        onError={() => setFailed(src)}
      />
    </span>
  );
}
