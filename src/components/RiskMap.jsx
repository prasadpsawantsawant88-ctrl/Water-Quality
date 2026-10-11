import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { LAKE_POLYGONS, LAKE_NAMES } from "../lib/data.js";
import { RISK_COLORS } from "../lib/risk.js";
import { GRID_STEP } from "../lib/gridStep.js";

// Leaflet map with schematic lake outlines (always drawn), optional OpenStreetMap tiles, risk markers and an
// optional interpolated-risk grid. Monitored = circle, unmonitored = diamond with dashed outline.
// Optional props (defaults keep the original risk-colour behaviour):
//   colorFn(r) -> marker colour, tooltipFn(r) -> tooltip HTML, ringFn(r) -> draw a dashed red ring,
//   gridCells entries may carry their own `color`, gridOpacity sets the layer opacity.
export default function RiskMap({ locations, selectedId, onSelect, height = 420, gridCells = null, showTiles = true, compact = false, colorFn = null, tooltipFn = null, ringFn = null, gridOpacity = 0.38, bounds = null }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const markerLayer = useRef(null);
  const gridLayer = useRef(null);
  const [tileFailed, setTileFailed] = useState(false);
  const boundsRef = useRef(bounds); // optional zoom window, e.g. one lake
  boundsRef.current = bounds;

  // create the map once
  useEffect(() => {
    const map = L.map(boxRef.current, { preferCanvas: true, zoomControl: !compact, attributionControl: true, scrollWheelZoom: !compact });
    const BOUNDS = [[41.4, -92.2], [48.9, -76.3]];
    const fit = () => map.fitBounds(boundsRef.current || BOUNDS);
    fit();
    // the container may not have its final size yet, so refit whenever it changes
    const ro = new ResizeObserver(() => { map.invalidateSize(); fit(); });
    ro.observe(boxRef.current);
    LAKE_NAMES.forEach((lake) => {
      const poly = L.polygon(LAKE_POLYGONS[lake], { color: "#5aa9e6", weight: 1.5, fillColor: "#1a2450", fillOpacity: 0.85, interactive: false }).addTo(map);
      const c = poly.getBounds().getCenter();
      c.lat += lake === "Erie" || lake === "Ontario" ? 0.55 : 0;
      L.marker(c, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="font:600 10px sans-serif;color:#aab3d6;opacity:.7;white-space:nowrap;transform:translate(-50%,-50%);text-shadow:0 0 4px #0a0d1a">${lake.toUpperCase()}</div>` }) }).addTo(map);
    });
    gridLayer.current = L.layerGroup().addTo(map);
    markerLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { ro.disconnect(); map.remove(); };
  }, [compact]);

  useEffect(() => {
    if (mapRef.current) mapRef.current.fitBounds(bounds || [[41.4, -92.2], [48.9, -76.3]]);
  }, [bounds]);

  // basemap tiles on/off (the app stays useful when tiles cannot be loaded)
  useEffect(() => {
    const map = mapRef.current;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    if (showTiles) {
      const t = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "&copy; OpenStreetMap contributors" });
      t.on("tileerror", () => setTileFailed(true));
      t.addTo(map);
      t.bringToBack();
      tileRef.current = t;
    }
  }, [showTiles]);

  // interpolated risk grid
  useEffect(() => {
    const g = gridLayer.current;
    g.clearLayers();
    if (!gridCells) return;
    gridCells.forEach((c) => {
      const b = [[c.lat - GRID_STEP.lat / 2, c.lon - GRID_STEP.lon / 2], [c.lat + GRID_STEP.lat / 2, c.lon + GRID_STEP.lon / 2]];
      L.rectangle(b, { stroke: false, fillColor: c.color || RISK_COLORS[c.level], fillOpacity: gridOpacity, interactive: false }).addTo(g);
    });
  }, [gridCells, gridOpacity]);

  // markers
  useEffect(() => {
    const layer = markerLayer.current;
    layer.clearLayers();
    locations.forEach((r) => {
      const color = (colorFn ? colorFn(r) : RISK_COLORS[r.level]) || "#8c95b3";
      const selected = r.id === selectedId;
      const gap = ringFn ? ringFn(r) : !r.monitored && r.p !== null && (r.level === "High" || r.level === "Critical") && r.confidence?.label !== "High";
      const size = selected ? 24 : 18;
      const shape = r.monitored
        ? `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${selected ? 3 : 2}px solid ${selected ? "#a98bff" : "#fff"};box-shadow:0 0 0 1px rgba(11,31,58,.35)"></div>`
        : `<div style="width:${size - 4}px;height:${size - 4}px;transform:rotate(45deg);background:${color}d9;border:2px dashed ${selected ? "#a98bff" : "#eef0fb99"};margin:2px"></div>`;
      const ring = gap ? `<div style="position:absolute;inset:-6px;border:2px dashed #ff5c6c;border-radius:50%"></div>` : "";
      const icon = L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div style="position:relative;width:${size}px;height:${size}px">${ring}${shape}</div>` });
      const m = L.marker([r.lat, r.lon], { icon, zIndexOffset: selected ? 1000 : 0 });
      const prob = r.p === null ? "no estimate" : `${(r.p * 100).toFixed(0)}% · ${r.level}`;
      m.bindTooltip(tooltipFn ? tooltipFn(r) : `<strong>${r.id}</strong> ${r.name}<br/>${r.monitored ? "Monitored" : "Unmonitored (estimated)"} · ${prob}`, { direction: "top", offset: [0, -8] });
      m.on("click", () => onSelect && onSelect(r.id));
      m.addTo(layer);
    });
  }, [locations, selectedId, onSelect, colorFn, tooltipFn, ringFn]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={boxRef} className={`h-full w-full rounded-lg ${!showTiles || tileFailed ? "no-tiles" : ""}`} />
      {showTiles && tileFailed && (
        <div className="absolute bottom-6 left-2 z-[500] rounded bg-[#0d1124]/90 px-2 py-1 text-[11px] text-slate-600 shadow">
          Basemap tiles unavailable offline. Showing schematic lake outlines only.
        </div>
      )}
    </div>
  );
}
