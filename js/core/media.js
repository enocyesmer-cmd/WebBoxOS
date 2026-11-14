/**
 * Utilidades puras para enlaces de video (sin DOM, fáciles de probar).
 * Reconoce enlaces de YouTube (video, lista, shorts, embed, youtu.be, con tiempo)
 * y archivos de video directos (.mp4, .webm...), locales o remotos.
 */
const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
]);
const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{10,64}$/;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv)$/i;
const RELATIVE = 'relative.invalid';

/** "1m30s", "90" -> segundos */
export function parseTimeParam(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

/**
 * @returns {{type:'youtube',videoId:string|null,listId:string|null,start:number}
 *          |{type:'video',src:string}|null}
 */
export function parseMediaUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return { type: 'youtube', videoId: raw, listId: null, start: 0 };

  let url;
  try {
    url = new URL(raw, `http://${RELATIVE}/`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    let videoId = null;
    if (host === 'youtu.be') videoId = parts[0];
    else if (parts[0] === 'watch') videoId = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) videoId = parts[1];
    if (videoId && !VIDEO_ID.test(videoId)) videoId = null;

    const list = url.searchParams.get('list');
    const listId = list && LIST_ID.test(list) ? list : null;
    if (!videoId && !listId) return null;

    const start = parseTimeParam(url.searchParams.get('t') || url.searchParams.get('start'));
    return { type: 'youtube', videoId, listId, start };
  }

  if (!/^https?:$/.test(url.protocol) || !VIDEO_EXT.test(url.pathname)) return null;
  const src = host === RELATIVE ? (raw.includes('%') ? raw : encodeURI(raw)) : url.href;
  return { type: 'video', src };
}

/** Miniatura automática de YouTube (null si solo hay lista). */
export function youtubeThumb(media) {
  return media?.type === 'youtube' && media.videoId
    ? `https://i.ytimg.com/vi/${media.videoId}/hqdefault.jpg`
    : null;
}

/** 83 -> "1:23", 3700 -> "1:01:40" */
export function formatTime(total) {
  const s = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
