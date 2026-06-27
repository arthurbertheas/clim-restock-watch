import { describe, it, expect } from "vitest";
import { detectStock, parseJsonLdAvailability } from "../src/detectStock";

const jsonLdPage = (availability: string) => `
<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Clim",
 "offers":{"@type":"Offer","price":"299","availability":"${availability}"}}
</script></head><body>contenu</body></html>`;

describe("parseJsonLdAvailability", () => {
  it("maps InStock URL to en_stock", () => {
    expect(parseJsonLdAvailability(jsonLdPage("https://schema.org/InStock"))).toBe("en_stock");
  });
  it("maps OutOfStock URL to rupture", () => {
    expect(parseJsonLdAvailability(jsonLdPage("https://schema.org/OutOfStock"))).toBe("rupture");
  });
  it("maps bare InStock token to en_stock", () => {
    expect(parseJsonLdAvailability(jsonLdPage("InStock"))).toBe("en_stock");
  });
  it("finds availability nested in an offers array", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","offers":[{"@type":"Offer","availability":"https://schema.org/OutOfStock"}]}
      </script>`;
    expect(parseJsonLdAvailability(html)).toBe("rupture");
  });
  it("returns null when no JSON-LD availability present", () => {
    expect(parseJsonLdAvailability("<html><body>rien</body></html>")).toBeNull();
  });
  it("ignores malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{ broken json </script>`;
    expect(parseJsonLdAvailability(html)).toBeNull();
  });
});

describe("detectStock fallback cascade", () => {
  it("uses match marker when JSON-LD absent (present -> en_stock)", () => {
    const html = "<html><body><button>Ajouter au panier</button></body></html>";
    expect(detectStock(html, "ajouter au panier")).toBe("en_stock");
  });
  it("uses match marker when JSON-LD absent (absent -> rupture)", () => {
    const html = "<html><body><span>Produit indisponible</span></body></html>";
    expect(detectStock(html, "ajouter au panier")).toBe("rupture");
  });
  it("heuristic: OOS terms without cart -> rupture", () => {
    const html = "<html><body>Ce produit est en rupture de stock</body></html>";
    expect(detectStock(html)).toBe("rupture");
  });
  it("heuristic: cart term without OOS -> en_stock", () => {
    const html = "<html><body><button>Ajouter au panier</button></body></html>";
    expect(detectStock(html)).toBe("en_stock");
  });
  it("ambiguous content -> inconnu", () => {
    const html = "<html><body>Bienvenue sur la boutique</body></html>";
    expect(detectStock(html)).toBe("inconnu");
  });
  it("JSON-LD wins over conflicting body text", () => {
    const html = jsonLdPage("https://schema.org/InStock") + "<div>indisponible</div>";
    expect(detectStock(html)).toBe("en_stock");
  });
});
