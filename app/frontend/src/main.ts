// src/main.ts
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const map = L.map("map", { center: [37.8, -122.3], zoom: 9 });

// Base map
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Helper: add a COG overlay via TileJSON from your backend
async function addCOG(cogUrl: string) {
  const tilejsonUrl =
    `http://localhost:8000/cog/WebMercatorQuad/tilejson.json?url=` +
    encodeURIComponent(cogUrl);

  const res = await fetch(tilejsonUrl);
  if (!res.ok) {
    console.error("TileJSON fetch failed:", res.status, await res.text());
    alert("Failed to load TileJSON. Check backend logs / CORS.");
    return;
  }

  const tj = await res.json();

  let tilesTemplate = tj.tiles?.[0];
  if (!tilesTemplate) throw new Error("No tiles[] in TileJSON");

  // Ensure correct prefix + explicit PNG
  tilesTemplate = tilesTemplate.replace(
    "http://localhost:8000/tiles/",
    "http://localhost:8000/cog/tiles/",
  ).replace(/(@\d+x)(?!\.\w+)/, "$1.png");

  // Build bounds from TileJSON: [west, south, east, north]
  const tjBounds = Array.isArray(tj.bounds) && tj.bounds.length === 4
    ? L.latLngBounds([ [tj.bounds[1], tj.bounds[0]], [tj.bounds[3], tj.bounds[2]] ])
    : undefined;

  // 1x1 transparent GIF for “no data” tiles to avoid console noise
  const transparentPx = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

  const imagery = L.tileLayer(tilesTemplate, {
    tileSize: 256,
    minZoom: tj.minzoom ?? 0,
    maxZoom: tj.maxzoom ?? 22,
    attribution: tj.attribution ?? "",
    crossOrigin: "anonymous",
    bounds: tjBounds,        // <-- constrain requests to the dataset footprint
    noWrap: true,            // <-- don’t wrap across the dateline
    keepBuffer: 0,           // <-- don’t overfetch tiles beyond viewport
    updateWhenIdle: true,    // <-- fewer interim fetches during pan/zoom
    errorTileUrl: transparentPx, // <-- avoid 404 errors showing up as broken images
    zIndex: 500,
  })
    .on("tileerror", (e: any) => console.warn("Tile outside footprint (suppressed):", e?.tile?.src || e))
    .on("tileload",  (e: any) => console.log("Tile loaded:", e?.tile?.src || e))
    .addTo(map);

  // Fit map to the COG footprint
  if (tjBounds) map.fitBounds(tjBounds);

  L.control.layers({ OpenStreetMap: osm }, { "Sentinel-2 (COG)": imagery }, { collapsed: false }).addTo(map);

  console.log("TileJSON:", tj);
}


// Example known-good Sentinel-2 TCI COG (true color)
const exampleCOG =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/10/S/DH/2025/2/S2B_10SDH_20250225_0_L2A/TCI.tif";
addCOG(exampleCOG);


// Optional: your STAC /search call (different endpoint on :8000)
async function runSearch() {
  const bbox = [-123.1, 37.3, -121.7, 38.2]; // SF Bay approx
  const start = "2025-01-01";
  const end = "2025-02-28";
  const cloud_max = 20;
  const url = new URL("http://localhost:8000/search");
  url.searchParams.set("bbox", bbox.join(","));
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("cloud_max", String(cloud_max));
  url.searchParams.set("limit", "20");

  const res = await fetch(url);
  console.log("Search status:", res.status);
  const data = await res.json();
  console.log("Search results:", data);
}
runSearch();

