# Trail

A personal, offline-first hiking app (web app saved to the iPhone home screen).
Spec: https://claude.ai/artifact/8QaoZNtTM3rFY51ArXw34V

## Layout

- `data-pipeline/` scripts that build trail data from OpenStreetMap and elevation tiles
- `data/<region>/` generated trail data (built by the "Build trail data" GitHub Action)
- `app/` the web app (coming in step 3)

## Building data

The GitHub Action runs on every push that touches `data-pipeline/`, or by hand from
the Actions tab. To run locally: `cd data-pipeline && npm ci && npm run build -- shenandoah`.

Data: © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (USGS 3DEP in the US).
