import { useEffect, useRef, useState } from "react";
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre looks for its worker next to its own module, which the bundle does
// not keep; Vite builds the worker as a separate file and gives its URL.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { holdVerticalSwipes } from "../telegram";
import { initialMapBounds, MAP_COLORS, MAP_STYLE_LIGHT, mapStyleFor, meetingFeatures, venueFeatures } from "../map";
import type { MapMeeting, MapPoints } from "../types";
import { t } from "../i18n";

type Props = {
  points: MapPoints;
  onVenue: (venueId: string) => void;
  /** One or several meetings under the tap. */
  onMeetings: (meetings: MapMeeting[]) => void;
};

setWorkerUrl(mapWorkerUrl);

// Loaded on demand (React.lazy): maplibre is the heaviest part of the app and
// only the map needs it.
/** The app theme lives on <html data-theme>; the map follows its changes. */
function useDocumentTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export default function VenueMap({ points, onVenue, onMeetings }: Props) {
  const theme = useDocumentTheme();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const styleLoaded = useRef(false);
  const styleFallback = useRef(false);
  const shownTheme = useRef(theme);
  const [unsupported, setUnsupported] = useState(false);
  // The latest data and handlers for callbacks registered once.
  const latest = useRef({ points, onVenue, onMeetings, theme });
  latest.current = { points, onVenue, onMeetings, theme };

  // A drag down must pan the map, not close the Mini App.
  useEffect(() => holdVerticalSwipes(), []);

  useEffect(() => {
    if (!container.current) return;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container: container.current,
        style: mapStyleFor(latest.current.theme),
        bounds: initialMapBounds(latest.current.points),
        fitBoundsOptions: { padding: 48, maxZoom: 15 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch (error) {
      // No WebGL (an old phone, a locked-down WebView): the list still works.
      console.warn("map_unsupported", error instanceof Error ? error.message : "unknown");
      setUnsupported(true);
      return;
    }
    map.current = instance;
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "top-right",
    );

    // A style that fails before it loads (a missing dark style, say) is
    // replaced by the light one, once. Tile errors come after style.load.
    instance.on("error", (event) => {
      console.warn("map_error", event.error?.message ?? "unknown");
      if (styleLoaded.current || styleFallback.current) return;
      styleFallback.current = true;
      instance.setStyle(MAP_STYLE_LIGHT, { diff: false });
    });

    // Sources and layers are part of the style: add them again after every
    // style load (style switches use diff: false, so this always fires).
    instance.on("style.load", () => {
      styleLoaded.current = true;
      const dark = latest.current.theme === "dark" && !styleFallback.current;
      addPointLayers(instance, dark ? "dark" : "light");
    });

    // One handler for every tap, so a meeting drawn over its venue opens the
    // meeting only. A small box around the tap forgives a finger.
    instance.on("click", (event) => {
      const { x, y } = event.point;
      const box: [[number, number], [number, number]] = [[x - 6, y - 6], [x + 6, y + 6]];
      const layers = ["meeting-points", "venue-points", "venue-clusters"].filter((id) => instance.getLayer(id));
      const features = instance.queryRenderedFeatures(box, { layers });
      // Several meetings at one venue share a point: all of them are offered.
      const meetingIds = new Set(features.filter((f) => f.layer.id === "meeting-points").map((f) => f.properties?.id));
      if (meetingIds.size) {
        latest.current.onMeetings(latest.current.points.meetings.filter((item) => meetingIds.has(item.id)));
        return;
      }
      const venue = features.find((f) => f.layer.id === "venue-points");
      if (typeof venue?.properties?.id === "string") {
        latest.current.onVenue(venue.properties.id);
        return;
      }
      const cluster = features.find((f) => f.layer.id === "venue-clusters");
      const clusterId = cluster?.properties?.cluster_id;
      if (cluster?.geometry.type !== "Point" || typeof clusterId !== "number") return;
      const center = cluster.geometry.coordinates as [number, number];
      void (instance.getSource("venues") as GeoJSONSource)
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => instance.easeTo({ center, zoom }));
    });
    for (const layer of ["venue-clusters", "venue-points", "meeting-points"]) {
      instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; });
      instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; });
    }
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // New points (another category) replace the data. Before the sources exist
  // there is nothing to update: style.load adds them with the latest points.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    (instance.getSource("venues") as GeoJSONSource | undefined)?.setData(venueFeatures(points.venues));
    (instance.getSource("meetings") as GeoJSONSource | undefined)?.setData(meetingFeatures(points.meetings));
  }, [points]);

  // The app theme switched: switch the map style too.
  useEffect(() => {
    const instance = map.current;
    if (!instance || shownTheme.current === theme) return;
    shownTheme.current = theme;
    styleLoaded.current = false;
    styleFallback.current = false;
    instance.setStyle(mapStyleFor(theme), { diff: false });
  }, [theme]);

  if (unsupported)
    return (
      <p className="venue-map venue-map-unsupported" role="status">
        {t("Карта не открывается на этом устройстве. Места и встречи можно посмотреть списком.")}</p>
    );
  return <div aria-label={t("Карта мест и открытых встреч")} className="venue-map" ref={container} role="region" />;

  function addPointLayers(instance: MapLibreMap, mode: "light" | "dark") {
    const colors = MAP_COLORS[mode];
    const { points: current } = latest.current;
    if (!instance.getSource("venues"))
      instance.addSource("venues", {
        type: "geojson",
        data: venueFeatures(current.venues),
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 15,
      });
    if (!instance.getSource("meetings"))
      instance.addSource("meetings", { type: "geojson", data: meetingFeatures(current.meetings) });
    instance.addLayer({
      id: "venue-clusters",
      type: "circle",
      source: "venues",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": colors.venue,
        "circle-opacity": 0.9,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
        "circle-stroke-color": colors.stroke,
        "circle-stroke-width": 2,
      },
    });
    instance.addLayer({
      id: "venue-cluster-count",
      type: "symbol",
      source: "venues",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
        "text-allow-overlap": true,
      },
      paint: { "text-color": colors.text },
    });
    instance.addLayer({
      id: "venue-points",
      type: "circle",
      source: "venues",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["case", ["get", "featured"], colors.featured, colors.venue],
        "circle-radius": 8,
        "circle-stroke-color": colors.stroke,
        "circle-stroke-width": 2,
      },
    });
    instance.addLayer({
      id: "meeting-points",
      type: "circle",
      source: "meetings",
      paint: {
        "circle-color": colors.meeting,
        "circle-radius": 11,
        "circle-stroke-color": colors.stroke,
        "circle-stroke-width": 3,
      },
    });
  }
}
