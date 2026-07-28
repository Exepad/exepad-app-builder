---
name: map-embed
description: "OpenStreetMap iframe embeds, lat/lng coordinate handling, marker placement. Load for any component that displays a map, store-locator, address pin, or lat/lng-keyed location. Keywords: map, location, openstreetmap, geo, latitude, longitude, marker, address."
metadata:
  kind: domain
---
# Skill: Map Embeds

## Map Options

### OpenStreetMap (Default — No API Key Required)
- Use `https://www.openstreetmap.org/export/embed.html`
- URL format: `?bbox=LON1,LAT1,LON2,LAT2&layer=mapnik&marker=LAT,LON`
- bbox = southwest corner (LON1,LAT1) to northeast corner (LON2,LAT2)
- Make bbox ~0.01 degrees wider than the marker in each direction

### Google Maps (When Requested)
- Use `https://www.google.com/maps/embed?pb=...` format
- Requires a Google Maps API key — only use when the user explicitly requests Google Maps
- Prefer OpenStreetMap when no specific map provider is requested

## iframe Attributes
- `loading="lazy"` — always set for performance
- `title="Map of {location}"` — accessibility requirement
- `className="w-full h-64 rounded-lg border-0"` — responsive, no border
- Height: `h-48` to `h-80` depending on prominence

## Dynamic Coordinates
- If coordinates come from state, build the embed URL in the component
- If building plan gives a city name without coordinates, use well-known center coordinates
