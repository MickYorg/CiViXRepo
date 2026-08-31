// Shared GNews adapter — used by both /api/headlines (live, on-demand)
// and /api/headlines-batch (the pre-warmed background batch), so the
// fetch/normalize logic exists in exactly one place. Files/directories
// prefixed with "_" aren't routed by Cloudflare Pages Functions, so this
// is safe to import without becoming its own endpoint.

// A brand-new citizen (no priorities yet, so no `q`) used to always get
// GNews's "nation" category — the same narrow slice of top headlines
// every time, batch-refreshed hourly, so a first-time swipe deck could
// look stale even right after a rebuild. Rotating the category by the
// hour instead spreads the same one-request-per-fetch budget across a
// wider, still-civically-relevant slice of the news, so "refresh" means
// real variety over time rather than the same nation-only feed forever.
const GENERAL_CATEGORIES = ['nation', 'world', 'business', 'science', 'health', 'environment'];
function pickGeneralCategory() {
  return GENERAL_CATEGORIES[new Date().getUTCHours() % GENERAL_CATEGORIES.length];
}

export async function fetchGNews(env, { q, limit }) {
  const apiKey = env.GNEWS_API_KEY;
  if (!apiKey) throw new Error('missing-key:GNEWS_API_KEY');
  const base = q
    ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=us`
    : `https://gnews.io/api/v4/top-headlines?category=${pickGeneralCategory()}&lang=en&country=us`;
  const url = `${base}&max=${limit}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gnews-http-${res.status}`);
  const data = await res.json();
  return (data.articles || []).map(slimArticle);
}

function slimArticle(a) {
  return {
    title: a.title || '',
    description: a.description || '',
    url: a.url || '',
    image: a.image || '',
    source: (a.source && a.source.name) || '',
    publishedAt: a.publishedAt || null
  };
}
