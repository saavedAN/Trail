# Trail

A personal, offline-first hiking app (web app saved to the iPhone home screen).
Spec: https://claude.ai/artifact/8QaoZNtTM3rFY51ArXw34V

## Layout

- `data-pipeline/` scripts that build trail data from OpenStreetMap and elevation tiles
- `data` branch: generated trail data (built by the "Build trail data" GitHub Action from Geofabrik OSM extracts)
- `app/` the web app (coming in step 3)

## Building data

The GitHub Action runs on every push that touches `data-pipeline/`, or by hand from
the Actions tab. To run locally: see `.github/workflows/build-data.yml` (needs osmium-tool).

Data: © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (USGS 3DEP in the US).
