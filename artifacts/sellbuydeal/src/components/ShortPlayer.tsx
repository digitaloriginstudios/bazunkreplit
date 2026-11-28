import { useEffect, useRef, useState } from "react";

export type ShortPlayback = {
  player: string;
  thumbnail: string;
  manifest: string;
  captionVtt: string | null;
  expiresAt: number;
};

export function ShortPlayer({
  media,
  title,
  onPlay,
  onEnded,
}: {
  media: ShortPlayback;
  title: string;
  onPlay?: () => void;
  onEnded?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);
  const [captions, setCaptions] = useState<string>();
  useEffect(() => {
    if (!media.captionVtt) return;
    const url = URL.createObjectURL(
      new Blob([media.captionVtt], { type: "text/vtt" }),
    );
    setCaptions(url);
    return () => URL.revokeObjectURL(url);
  }, [media.captionVtt]);
  useEffect(() => {
    const node = video.current;
    if (!node || fallback) return;
    if (node.canPlayType("application/vnd.apple.mpegurl")) {
      node.src = media.manifest;
      return;
    }
    let disposed = false;
    let destroy: (() => void) | undefined;
    void import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          setFallback(true);
          return;
        }
        const hls = new Hls({ enableWebVTT: false });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setFallback(true);
        });
        hls.loadSource(media.manifest);
        hls.attachMedia(node);
      })
      .catch(() => {
        if (!disposed) setFallback(true);
      });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [media.manifest, fallback]);

  return fallback ? (
    <iframe
      className="aspect-[9/16] max-h-[62dvh] w-full rounded-lg bg-black"
      src={media.player}
      title={title}
      allowFullScreen
    />
  ) : (
    <video
      ref={video}
      className="aspect-[9/16] max-h-[62dvh] w-full rounded-lg bg-black object-contain"
      aria-label={title}
      controls
      playsInline
      preload="metadata"
      crossOrigin="anonymous"
      poster={media.thumbnail}
      onError={() => setFallback(true)}
      onPlay={onPlay}
      onEnded={onEnded}
    >
      <track
        kind="captions"
        label="English"
        srcLang="en"
        src={captions}
        default
      />
    </video>
  );
}
