# Kimberley Signage Survey

Photo-clustering pipeline for Kimberley Nature Trail Society: turn geotagged trail photos into clustered locations and map outputs for intersection/signage decisions.

## Pipeline

1. **cluster** — Read EXIF from `photos/`, cluster by proximity (30 m), write `data/clusters.json`
2. **har_to_trails** — Convert Trailforks HAR into `data/trails.json` (requires manual HAR capture)
3. **enrich** — Match clusters to trails within buffer (radius + 30 m), write `data/intersections.geojson` and `data/intersections.csv`

## Requirements

- [Bun](https://bun.sh)

## Setup

```bash
bun install
```

## Usage

### 1. Cluster photos

Put geotagged photos in `photos/`.

```bash
bun run cluster
```

### 2. Capture trail data

Capture HAR with **multiple activity types** so trail activity support is correct. Load the region with each activity selected (Snowshoe, Nordic ski, Winter fat bike, Summer MTB) so the corresponding RMS requests are captured.

1. Open [Trailforks Kimberley region](https://www.trailforks.com/region/kimberley-3023/)
2. DevTools → Network → clear
3. Select **Snowshoe**, wait for map to load
4. Select **Nordic ski**, wait for map to load
5. Select **Winter fat bike**, wait for map to load
6. Select **Summer MTB**, wait for map to load
7. Right-click in Network tab → Save all as HAR → save as `data/www.trailforks.com.har`

```bash
bun run har_to_trails
```

### 3. Enrich intersections

```bash
bun run enrich
```

### 4. View map

```bash
bun run serve
```

Open http://localhost:3000

## Outputs

| File | Description |
|------|-------------|
| `data/clusters.json` | Photo clusters with center, radius, photo list |
| `data/trails.json` | Trail GeoJSON (LineStrings) from Trailforks |
| `data/intersections.geojson` | Intersection points with trail counts, sorted by trail_count desc |
| `data/intersections.csv` | Same as GeoJSON, CSV format |

## Map

The map shows trails and intersections over a topo or satellite base layer. Filters:

- **Trail count** — min/max trails at intersection
- **Radius (m)** — min/max cluster radius

Default: intersections with 2+ trails.

## Deployment

Pushes to `main` deploy to [GitHub Pages](https://bevanr.github.io/kimberley-signage-survey/). Ensure repo Settings → Pages → source is GitHub Actions.
