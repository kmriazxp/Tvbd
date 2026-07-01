// /api/news.js
// Server-side RSS aggregator for Vercel Serverless Functions.
// Fetching happens here (server), so the browser never hits CORS issues.

const FEEDS = {
  prothomalo:  { label: "প্রথম আলো",          urls: ["https://www.prothomalo.com/feed"] },
  bdnews24:    { label: "বিডিনিউজ২৪",          urls: ["https://bangla.bdnews24.com/?widgetName=rssfeed&widgetId=1145&getXmlFeed=true"] },
  jugantor:    { label: "যুগান্তর",            urls: ["https://www.jugantor.com/rss.xml"] },
  samakal:     { label: "সমকাল",               urls: ["https://samakal.com/rss/rss.xml"] },
  ittefaq:     { label: "ইত্তেফাক",            urls: ["https://www.ittefaq.com.bd/rss.xml"] },
  bdpratidin:  { label: "বাংলাদেশ প্রতিদিন",    urls: ["https://www.bd-pratidin.com/rss.xml"] },
  dhakatribune:{ label: "Dhaka Tribune",       urls: ["https://www.dhakatribune.com/feed"] },
  dailystar:   { label: "Daily Star",          urls: ["https://www.thedailystar.net/rss.xml"] },
  bbcbangla:   { label: "BBC বাংলা",           urls: ["https://feeds.bbci.co.uk/bengali/rss.xml"] },
};

function stripCdata(s) {
  if (!s) return "";
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(stripCdata(m[1])).trim() : "";
}

function parseRSS(xml, sourceLabel) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    const pubDate =
      extractTag(block, "pubDate") || extractTag(block, "dc:date") || extractTag(block, "published") || "";
    if (title) {
      items.push({ title, link: link || "#", pubDate, source: sourceLabel });
    }
  }
  return items;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BDNewsHub/1.0; +https://vercel.app)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const key = (req.query.key || "all").toString();
  const feedKeys = key === "all" ? Object.keys(FEEDS) : [key];

  const validKeys = feedKeys.filter((k) => FEEDS[k]);
  if (validKeys.length === 0) {
    return res.status(400).json({ error: "Unknown feed key", items: [] });
  }

  try {
    const results = await Promise.all(
      validKeys.map(async (k) => {
        const feed = FEEDS[k];
        let collected = [];
        for (const url of feed.urls) {
          const xml = await fetchWithTimeout(url, 8000);
          if (xml) collected = collected.concat(parseRSS(xml, feed.label));
        }
        return collected;
      })
    );

    let items = results.flat();
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    items = items.slice(0, 60);

    return res.status(200).json({ items, count: items.length });
  } catch (e) {
    return res.status(500).json({ error: "fetch_failed", items: [] });
  }
}
