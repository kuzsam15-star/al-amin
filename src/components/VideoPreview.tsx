import { ExternalLink, Film } from "lucide-react";

type Video = { provider: string; embed: string | null; url: string; host: string };

const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

function youtubeId(url: URL) {
  if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
  return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1] ?? null;
}

function video(value: string): Video | null {
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const youTube = youtubeId(url);
  if (youTube && /^[\w-]{6,}$/.test(youTube)) return { provider: "YouTube", embed: `https://www.youtube-nocookie.com/embed/${youTube}`, url: url.toString(), host };
  const rutubeId = /(^|\.)rutube\.ru$/.test(host) ? url.pathname.match(/(?:video|embed)\/([\w-]+)/)?.[1] : null;
  if (rutubeId) return { provider: "RUTUBE", embed: `https://rutube.ru/play/embed/${rutubeId}`, url: url.toString(), host };
  const vkPath = url.pathname.match(/video(-?\d+)_([\d]+)/);
  const vkQuery = url.searchParams.get("z")?.match(/video(-?\d+)_([\d]+)/);
  const vk = /(^|\.)(?:vkvideo\.ru|vk\.com|vk\.ru)$/.test(host) ? (vkPath ?? vkQuery) : null;
  if (vk) return { provider: "VK Видео", embed: `https://vkvideo.ru/video_ext.php?oid=${vk[1]}&id=${vk[2]}&hd=2`, url: url.toString(), host };
  return { provider: host, embed: null, url: url.toString(), host };
}

export function VideoPreview({ url }: { url: string }) {
  const item = video(url);
  if (!item) return null;
  return <article className="video-preview">
    <header><span className="video-preview-icon"><Film size={17} /></span><strong>{item.provider}</strong><a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть видео на ${item.provider}`}><ExternalLink size={17} /><span>Открыть</span></a></header>
    {item.embed ? <iframe src={item.embed} title={`Видео: ${item.provider}`} loading="lazy" referrerPolicy="no-referrer" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : <a className="video-preview-fallback" href={item.url} target="_blank" rel="noopener noreferrer"><Film size={26} /><span><strong>Видео на {item.provider}</strong><small>{item.host}</small></span><ExternalLink size={18} /></a>}
  </article>;
}
