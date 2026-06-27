import * as cheerio from "cheerio";
import type { StockStatus } from "./types";

const IN_STOCK_TERMS = [
  "instock", "limitedavailability", "preorder", "backorder",
  "onlineonly", "instoreonly", "presale",
];
const OUT_OF_STOCK_TERMS = ["outofstock", "soldout", "discontinued"];

function collectAvailability(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectAvailability(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.toLowerCase() === "availability" && typeof value === "string") {
        out.push(value);
      } else {
        collectAvailability(value, out);
      }
    }
  }
}

export function parseJsonLdAvailability(html: string): StockStatus | null {
  const $ = cheerio.load(html);
  const found: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // ignore malformed JSON-LD
    }
    collectAvailability(data, found);
  });
  if (found.length === 0) return null;
  const norm = found.map((a) => a.toLowerCase().split("/").pop() ?? "");
  if (norm.some((a) => IN_STOCK_TERMS.includes(a))) return "en_stock";
  if (norm.some((a) => OUT_OF_STOCK_TERMS.includes(a))) return "rupture";
  return null;
}

export function detectStock(html: string, match?: string | null): StockStatus {
  const jsonLd = parseJsonLdAvailability(html);
  if (jsonLd) return jsonLd;

  if (match && match.trim()) {
    return html.toLowerCase().includes(match.toLowerCase()) ? "en_stock" : "rupture";
  }

  const text = html.toLowerCase();
  const hasOOS = /indisponible|rupture|épuisé|epuise|out of stock|sold out/.test(text);
  const hasCart = /ajouter au panier|add to cart|en stock|disponible/.test(text);
  if (hasOOS && !hasCart) return "rupture";
  if (hasCart && !hasOOS) return "en_stock";
  return "inconnu";
}
