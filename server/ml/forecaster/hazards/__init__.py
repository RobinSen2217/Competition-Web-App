"""Hazard datasets and models (the Disaster module), separate from the NDVI
forecaster in the parent package.

Every hazard follows the same two steps, so a new hazard (heatwave, drought,
...) plugs in next to flood without touching the server's routes:

1. **Import** (`python -m forecaster.hazards import <hazard> ...`): turns the
   team's extracted files into a normalized, documented dataset in
   `server/data/hazards/<hazard>/` (`events.json` plus per-event CSVs, see
   `dataset.py`).
2. **Build** (`python -m forecaster.hazards build <hazard>`): runs the hazard's
   model on that dataset and writes a snapshot to
   `server/data/hazards/<hazard>/model/`, which the API serves.

Optionally the import also writes per-event map layers (`layers.py`: a
classified GeoTIFF -> overlay PNG + stats in `layers.json`).

Flood: `import_flood.py` (GPM IMERG rainfall + NISAR soil moisture of 10
events, and with `--layers` the notebook's Part A reference water labels)
and `flood.py` (the flood notebook's Part B: Random Forest "flood
within the next 3 days" forecast with out-of-fold thresholds).
"""
