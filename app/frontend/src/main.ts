import "leaflet/dist/leaflet.css";
import L from "leaflet";

const map = L.map("map", { center: [37.8, -122.3], zoom: 9 });

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);

let mosaicLayer: L.TileLayer | null = null;
let requestAbort: AbortController | null = null;

function bboxFromMap(m: L.Map) {
  const b = m.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

// Try to pull a COG URL from different result shapes
function extractCogUrl(it: any): string | null {
  return (
    it.asset_href ||     // <-- your backend field
    it.cog_url ||
    it.url ||
    it.assets?.TCI?.href ||
    it.assets?.tci?.href ||
    null
  );
}

async function buildMosaicForView() {
  try {
    // cancel any in-flight run
    requestAbort?.abort();
    requestAbort = new AbortController();

    // 1) SEARCH
    const bbox = bboxFromMap(map);
    const url = new URL("http://localhost:8000/search");
    url.searchParams.set("bbox", bbox.join(","));
    // widen dates while testing; tighten later
    url.searchParams.set("start", "2024-12-01");
    url.searchParams.set("end", "2025-03-31");
    url.searchParams.set("cloud_max", "80");
    url.searchParams.set("limit", "50");

    console.log("[search] GET", url.toString());
    const searchRes = await fetch(url, { signal: requestAbort.signal });
    console.log("[search] status", searchRes.status);
    if (!searchRes.ok) {
      console.error("[search] body:", await searchRes.text());
      return;
    }
    const searchData = await searchRes.json();
    const items: any[] = searchData.results || searchData.items || searchData.features || [];
    console.log("[search] count:", items.length);
    if (!items.length) {
      if (mosaicLayer) { map.removeLayer(mosaicLayer); mosaicLayer = null; }
      console.warn("[search] no results for bbox", bbox);
      return;
    }

    // sort (lowest cloud then newest)
    items.sort((a: any, b: any) => {
      const ac = a.cloud_cover ?? a.cloudcover ?? a.properties?.["eo:cloud_cover"] ?? 999;
      const bc = b.cloud_cover ?? b.cloudcover ?? b.properties?.["eo:cloud_cover"] ?? 999;
      if (ac !== bc) return ac - bc;
      const ad = new Date(a.datetime || a.properties?.datetime || 0).getTime();
      const bd = new Date(b.datetime || b.properties?.datetime || 0).getTime();
      return bd - ad;
    });

    // extract + dedupe URLs
    const urls = Array.from(
      new Set(items.map(extractCogUrl).filter(Boolean) as string[])
    );
    console.log("[search] extracted urls:", urls.length, urls.slice(0, 3));
    if (!urls.length) {
      console.warn("[search] couldn’t extract COG URLs from results[0]:", items[0]);
      return;
    }

    // 2) MOSAIC via query params (no POST, no TileJSON)
    // Keep the list modest to avoid huge query strings.
    const top = urls.slice(0, 50); // send up to ~50; adjust as you like
    const mosaicRes = await fetch("http://localhost:8000/mosaics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: top,
        minzoom: 6,
        maxzoom: 14,
        quadkey_zoom: 12,
      }),
      signal: requestAbort.signal,
    });
    console.log("[mosaics] status", mosaicRes.status);
    if (!mosaicRes.ok) {
      console.error("[mosaics] body:", await mosaicRes.text());
      return;
    }
    const { id } = await mosaicRes.json();

    // 3) Ask TiTiler for TileJSON using the hosted MosaicJSON URL
    const mosaicUrl = encodeURIComponent(`http://localhost:8000/mosaics/${id}`);
    const tjUrl = `http://localhost:8000/mosaic/WebMercatorQuad/tilejson.json?url=${mosaicUrl}`;
    console.log("[tilejson] GET", tjUrl);
    const tjRes = await fetch(tjUrl, { signal: requestAbort.signal });
    console.log("[tilejson] status", tjRes.status);
    if (!tjRes.ok) {
      console.error("[tilejson] body:", await tjRes.text());
      return;
    }
    const tj = await tjRes.json();

    let template = (tj.tiles?.[0] || "");
    if (!template) {
      console.warn("[tilejson] no tiles[0] in response");
      return;
    }
    // ensure explicit .png if missing
    template = template.replace(/(@\d+x)(?!\.\w+)/, "$1.png");
    template = template
    .replace("http://localhost:8000/tiles/", "http://localhost:8000/mosaic/tiles/")
    .replace(/(@\d+x)(?!\.\w+)/, "$1.png");
    console.log("[tiles] template:", template);

    // 4) SWAP LAYER
    if (mosaicLayer) { map.removeLayer(mosaicLayer); mosaicLayer = null; }

    const transparentPx =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    mosaicLayer = L.tileLayer(template, {
      tileSize: 256,
      minZoom: tj.minzoom ?? 0,
      maxZoom: tj.maxzoom ?? 22,
      attribution: tj.attribution ?? "Sentinel-2 via COGs",
      crossOrigin: "anonymous",
      noWrap: true,
      keepBuffer: 0,
      updateWhenIdle: true,
      errorTileUrl: transparentPx,
      zIndex: 500,
    })
      .on("tileerror", e => console.warn("[tiles] error:", e?.tile?.src))
      .on("tileload",  e => console.log("[tiles] loaded:", e?.tile?.src))
      .addTo(map);

    // (optional) fit once on first load
    if (tj.bounds) {
      const b = L.latLngBounds([[tj.bounds[1], tj.bounds[0]], [tj.bounds[3], tj.bounds[2]]]);
      if (!map.getBounds().intersects(b)) map.fitBounds(b);
    }

  } catch (err: any) {
    if (err?.name !== "AbortError") console.error(err);
  }
}

// Debounce updates on pan/zoom
let timer: number | undefined;
map.on("moveend", () => { clearTimeout(timer); timer = window.setTimeout(buildMosaicForView, 250); });

// Initial load
buildMosaicForView();
