import { verifyRequest } from "../_shared/auth.js";
import { json } from "../_shared/http.js";

const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}, timeoutMs) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.json();
}

async function fetchText(url, options = {}, timeoutMs) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.text();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCountry(value) {
  const country = String(value || "US").toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "US";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/\b(feat(?:uring)?|ft)\.?\s+.+$/iu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizeText(left).split(/\s+/).filter(Boolean));
  const b = new Set(normalizeText(right).split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

const VERSION_TERMS = [
  "live", "remix", "remaster", "remastered", "instrumental", "karaoke",
  "acoustic", "demo", "edit", "version", "sped", "slowed", "cover",
  "rework", "mix", "radio"
];

function versionPenalty(candidateTitle, wantedTitle) {
  const candidate = new Set(normalizeText(candidateTitle).split(/\s+/));
  const wanted = new Set(normalizeText(wantedTitle).split(/\s+/));
  let penalty = 0;
  for (const term of VERSION_TERMS) {
    if (candidate.has(term) && !wanted.has(term)) penalty += 0.13;
    if (wanted.has(term) && !candidate.has(term)) penalty += 0.06;
  }
  return penalty;
}

function matchScore(candidateTitle, candidateArtist, wantedTitle, wantedArtist) {
  const normalizedCandidateTitle = normalizeText(candidateTitle);
  const normalizedWantedTitle = normalizeText(wantedTitle);
  const normalizedCandidateArtist = normalizeText(candidateArtist);
  const normalizedWantedArtist = normalizeText(wantedArtist);

  let score =
    tokenSimilarity(candidateTitle, wantedTitle) * 0.62 +
    tokenSimilarity(candidateArtist, wantedArtist) * 0.38;

  if (normalizedCandidateTitle && normalizedCandidateTitle === normalizedWantedTitle) score += 0.34;
  if (normalizedCandidateArtist && normalizedCandidateArtist === normalizedWantedArtist) score += 0.24;
  if (
    normalizedCandidateTitle && normalizedWantedTitle &&
    (normalizedCandidateTitle.includes(normalizedWantedTitle) ||
      normalizedWantedTitle.includes(normalizedCandidateTitle))
  ) score += 0.07;

  return score - versionPenalty(candidateTitle, wantedTitle);
}

function parseSpotifyTitle(value) {
  const cleaned = String(value || "")
    .replace(/\s*\|\s*Spotify\s*$/i, "")
    .replace(/^Spotify Embed:\s*/i, "")
    .trim();
  const patterns = [
    /^(.*?)\s*[–—-]\s*song and lyrics by\s*(.*?)$/i,
    /^(.*?)\s*[–—-]\s*song by\s*(.*?)$/i,
    /^(.*?)\s*[–—-]\s*single by\s*(.*?)$/i,
    /^(.*?)\s*[–—-]\s*album by\s*(.*?)$/i,
    /^(.*?)\s*[·|]\s*(.*?)$/i,
    /^(.*?)\s+by\s+(.+?)$/i
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) return { title: match[1].trim(), artist: match[2].trim() };
  }
  return { title: cleaned, artist: "" };
}

function odesliMetadata(result) {
  const entitiesById = result?.entitiesByUniqueId || {};
  const ids = unique([
    result?.linksByPlatform?.spotify?.entityUniqueId,
    result?.entityUniqueId
  ]);
  const candidates = [
    ...ids.map(id => entitiesById[id]),
    ...Object.values(entitiesById).filter(entity => entity?.apiProvider === "spotify"),
    ...Object.values(entitiesById)
  ].filter(Boolean);
  const entity = candidates.find(item => item?.artistName) || candidates[0] || {};
  return {
    title: entity.title || result?.title || "",
    artist: entity.artistName || result?.artistName || result?.artist || "",
    thumbnail: entity.thumbnailUrl || result?.thumbnailUrl || result?.thumbnail || "",
    type: entity.type || result?.type || "song"
  };
}

function platformUrl(result, keys) {
  const links = result?.linksByPlatform || {};
  for (const key of keys) {
    const value = links[key]?.url;
    if (value) return value;
  }
  return "";
}

function youtubeMusicUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname === "music.youtube.com") return url.toString();
    let videoId = url.searchParams.get("v");
    if (!videoId && url.hostname === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0];
    if (videoId) return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  } catch {}
  return "";
}

async function resolveOdesli(spotifyUrl, country) {
  const endpoint = new URL("https://api.song.link/v1-alpha.1/links");
  endpoint.searchParams.set("url", spotifyUrl);
  endpoint.searchParams.set("userCountry", country);
  return fetchJson(endpoint.toString(), {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }
  });
}

async function resolveAppleMusic(title, artist, preferredCountry) {
  if (!title || !artist) return null;
  const countries = unique([preferredCountry, "US", "GB", "CA", "AU", "NZ"]);
  let best = null;

  for (const country of countries) {
    const endpoint = new URL("https://itunes.apple.com/search");
    endpoint.searchParams.set("term", `${title} ${artist}`);
    endpoint.searchParams.set("country", country);
    endpoint.searchParams.set("media", "music");
    endpoint.searchParams.set("entity", "song");
    endpoint.searchParams.set("attribute", "songTerm");
    endpoint.searchParams.set("limit", "30");
    endpoint.searchParams.set("explicit", "Yes");

    try {
      const result = await fetchJson(endpoint.toString(), {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT }
      });
      for (const item of result?.results || []) {
        if (!item?.trackViewUrl || !item?.trackName || !item?.artistName) continue;
        const score = matchScore(item.trackName, item.artistName, title, artist);
        if (!best || score > best.score) best = { score, item };
      }
      if (best?.score >= 1.12) break;
    } catch {
      // Try the next storefront.
    }
  }

  if (!best || best.score < 0.76) return null;
  return {
    url: best.item.trackViewUrl,
    title: best.item.trackName,
    artist: best.item.artistName,
    artwork: best.item.artworkUrl100 || "",
    score: best.score
  };
}

function extractJsonObject(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function textFromRuns(value) {
  if (!value) return "";
  if (value.simpleText) return value.simpleText;
  return (value.runs || []).map(run => run.text || "").join("");
}

function firstVideoId(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.videoId === "string" && value.videoId) return value.videoId;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstVideoId(item);
      if (result) return result;
    }
    return "";
  }
  for (const item of Object.values(value)) {
    const result = firstVideoId(item);
    if (result) return result;
  }
  return "";
}

function collectYouTubeCandidates(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectYouTubeCandidates(item, output);
    return output;
  }

  if (value.musicResponsiveListItemRenderer) {
    const renderer = value.musicResponsiveListItemRenderer;
    const columns = (renderer.flexColumns || []).map(column =>
      column?.musicResponsiveListItemFlexColumnRenderer?.text
    );
    output.push({
      title: textFromRuns(columns[0]),
      subtitle: columns.slice(1).map(textFromRuns).filter(Boolean).join(" • "),
      videoId: renderer.playlistItemData?.videoId || firstVideoId(renderer)
    });
  }

  if (value.musicTwoRowItemRenderer) {
    const renderer = value.musicTwoRowItemRenderer;
    output.push({
      title: textFromRuns(renderer.title),
      subtitle: textFromRuns(renderer.subtitle),
      videoId: renderer.navigationEndpoint?.watchEndpoint?.videoId || firstVideoId(renderer)
    });
  }

  if (value.videoRenderer) {
    const renderer = value.videoRenderer;
    output.push({
      title: textFromRuns(renderer.title),
      subtitle: [textFromRuns(renderer.ownerText), textFromRuns(renderer.shortBylineText)]
        .filter(Boolean).join(" • "),
      videoId: renderer.videoId || firstVideoId(renderer)
    });
  }

  for (const item of Object.values(value)) collectYouTubeCandidates(item, output);
  return output;
}

function bestYouTubeCandidate(candidates, title, artist) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate.videoId || !candidate.title) continue;
    let score = matchScore(candidate.title, candidate.subtitle, title, artist);
    const subtitle = normalizeText(candidate.subtitle);
    const wantedArtist = normalizeText(artist);
    if (wantedArtist && subtitle.includes(wantedArtist)) score += 0.2;
    if (/\b(song|official audio|topic)\b/i.test(candidate.subtitle)) score += 0.06;
    if (/\b(karaoke|cover|reaction|tutorial)\b/i.test(candidate.title + " " + candidate.subtitle)) score -= 0.32;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best && best.score >= 0.72 ? best : null;
}

async function fetchYouTubeInitialData(url) {
  const html = await fetchText(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": USER_AGENT,
      Cookie: "CONSENT=YES+1; SOCS=CAI"
    }
  }, 18000);

  const markers = [
    "var ytInitialData =",
    "window['ytInitialData'] =",
    'window["ytInitialData"] =',
    "ytInitialData ="
  ];
  for (const marker of markers) {
    const data = extractJsonObject(html, marker);
    if (data) return data;
  }
  return null;
}

async function resolveYouTubeMusic(title, artist, country) {
  if (!title || !artist) return null;
  const query = `${title} ${artist}`;
  const urls = [
    `https://music.youtube.com/search?q=${encodeURIComponent(query)}&hl=en&gl=${encodeURIComponent(country)}`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} official audio`)}`
  ];

  for (const url of urls) {
    try {
      const initialData = await fetchYouTubeInitialData(url);
      if (!initialData) continue;
      const best = bestYouTubeCandidate(collectYouTubeCandidates(initialData), title, artist);
      if (best) {
        return {
          url: `https://music.youtube.com/watch?v=${encodeURIComponent(best.videoId)}`,
          title: best.title,
          artist: best.subtitle,
          score: best.score
        };
      }
    } catch {
      // Try the next YouTube surface.
    }
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyRequest(request, env))) return json({ error: "Unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const spotifyUrl = String(body?.spotifyUrl || "").trim();
  if (!/^https:\/\/(open\.spotify\.com|spotify\.link)\//i.test(spotifyUrl)) {
    return json({ error: "A valid Spotify URL is required." }, 400);
  }

  const country = normalizeCountry(body?.country);
  let title = String(body?.title || "").trim();
  let artist = String(body?.artist || "").trim();
  const links = { spotify: spotifyUrl, appleMusic: "", youtubeMusic: "", amazonMusic: "" };
  let metadata = { title, artist, thumbnail: "", type: "song" };
  const sources = {};

  const [oembedResult, odesliResult] = await Promise.allSettled([
    fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT }
    }),
    resolveOdesli(spotifyUrl, country)
  ]);

  if (oembedResult.status === "fulfilled") {
    const parsed = parseSpotifyTitle(oembedResult.value?.title);
    if (!title && parsed.title) title = parsed.title;
    if (!artist && parsed.artist) artist = parsed.artist;
    metadata.thumbnail = oembedResult.value?.thumbnail_url || "";
  }

  if (odesliResult.status === "fulfilled") {
    const result = odesliResult.value;
    const odesli = odesliMetadata(result);
    title = odesli.title || title;
    artist = odesli.artist || artist;
    metadata = {
      title,
      artist,
      thumbnail: odesli.thumbnail || metadata.thumbnail,
      type: odesli.type || "song"
    };

    links.spotify = platformUrl(result, ["spotify"]) || spotifyUrl;
    links.appleMusic = platformUrl(result, ["appleMusic", "itunes"]);
    links.youtubeMusic = youtubeMusicUrl(platformUrl(result, ["youtubeMusic", "youtube"]));
    links.amazonMusic = platformUrl(result, ["amazonMusic"]);
    if (links.appleMusic) sources.appleMusic = "Odesli exact match";
    if (links.youtubeMusic) sources.youtubeMusic = "Odesli exact match";
    if (links.amazonMusic) sources.amazonMusic = "Odesli exact match";
  }

  if (!links.appleMusic && title && artist) {
    const apple = await resolveAppleMusic(title, artist, country);
    if (apple) {
      links.appleMusic = apple.url;
      sources.appleMusic = "Apple catalog match";
    }
  }

  if (!links.youtubeMusic && title && artist) {
    const youtube = await resolveYouTubeMusic(title, artist, country);
    if (youtube) {
      links.youtubeMusic = youtube.url;
      sources.youtubeMusic = "YouTube Music match";
    }
  }

  return json({
    ok: true,
    metadata: { ...metadata, title, artist },
    links,
    sources
  });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "cache-control": "no-store"
    }
  });
}

export function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
