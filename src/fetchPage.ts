const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCK_MARKERS =
  /captcha|datadome|are you a human|access denied|pardon our interruption|request unsuccessful|cf-browser-verification|enable javascript and cookies/i;

export interface FetchResult {
  html: string;
  blocked: boolean;
}

export function classifyResponse(status: number, html: string): boolean {
  if (status >= 400) return true;
  if (html.trim().length < 500) return true;
  if (BLOCK_MARKERS.test(html)) return true;
  return false;
}

export async function httpFetch(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return { html: "", blocked: true };
    const html = await res.text();
    return { html, blocked: classifyResponse(res.status, html) };
  } catch {
    return { html: "", blocked: true };
  }
}

export async function firecrawlFetch(url: string, apiKey: string): Promise<FetchResult> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
    });
    if (!res.ok) return { html: "", blocked: true };
    const json = (await res.json()) as { success?: boolean; data?: { rawHtml?: string } };
    const html = json.data?.rawHtml ?? "";
    return { html, blocked: classifyResponse(200, html) };
  } catch {
    return { html: "", blocked: true };
  }
}
