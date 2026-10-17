"""Monthly aggregation, notebook cells 19 (aggregate_monthly) and 39
(aggregate_monthly_chunked).

The Earth Engine parts are the notebook's code; the bits that need no Earth
Engine (turning the result into a table, the chunk plan, the retry rule) are
small functions of their own so they can be tested offline.
"""

import logging
import time

import ee
import pandas as pd

log = logging.getLogger('forecaster.gee')

CONCURRENCY_ERROR = 'Too many concurrent aggregations'


def records_to_frame(result):
    """FeatureCollection.getInfo() -> one row per month, sorted by date."""
    records = [feature['properties'] for feature in result['features']]
    df = pd.DataFrame(records)
    return df.sort_values('date').reset_index(drop=True)


def aggregate_monthly(collection, geometry, start_date, end_date, bands, reducer, scale):
    """Cell 19: per calendar month, mean image of `bands`, reduced over `geometry`."""
    start = ee.Date(start_date)
    end = ee.Date(end_date)
    n_months = end.difference(start, 'month').round()

    # Server-side list of month offsets: [0, 1, 2, ..., n_months-1]
    months = ee.List.sequence(0, n_months.subtract(1))

    def monthly_feature(month_offset):
        month_offset = ee.Number(month_offset)
        month_start = start.advance(month_offset, 'month')
        month_end = month_start.advance(1, 'month')

        monthly_img = collection.filterDate(month_start, month_end).select(bands).mean()

        stats = monthly_img.reduceRegion(
            reducer=reducer, geometry=geometry, scale=scale, maxPixels=1e9, bestEffort=True
        )

        # Wrap into a Feature so the result survives the server-side map()
        return ee.Feature(None, stats.set('date', month_start.format('YYYY-MM-dd')))

    # Runs entirely on Google's servers; one batched retrieval of every month.
    monthly_fc = ee.FeatureCollection(months.map(monthly_feature))
    return records_to_frame(monthly_fc.getInfo())


def chunk_offsets(total_months, chunk_months):
    """[(start offset, end offset), ...] covering 0..total_months, cell 39's loop."""
    return [(s, min(s + chunk_months, total_months)) for s in range(0, total_months, chunk_months)]


def with_retries(fn, max_retries=3, sleep=time.sleep):
    """Cell 39's retry rule: only Earth Engine's concurrency limit is retried,
    waiting 5 s, 10 s, ...; any other error, or the last attempt, is raised."""
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            if CONCURRENCY_ERROR in str(e) and attempt < max_retries - 1:
                wait_time = 5 * (attempt + 1)
                log.info('Hit concurrency limit, retrying in %ss (attempt %d/%d)...',
                         wait_time, attempt + 1, max_retries)
                sleep(wait_time)
            else:
                raise
    return None  # unreachable for max_retries >= 1; the loop returns or raises


def aggregate_monthly_chunked(collection, geometry, start_date, end_date, bands, reducer, scale,
                              chunk_months=6, max_retries=3, sleep=time.sleep):
    """Cell 39: aggregate_monthly in chunks of `chunk_months`, for collections
    (Dynamic World) too heavy to aggregate in one request."""
    start = ee.Date(start_date)
    end = ee.Date(end_date)
    total_months = int(end.difference(start, 'month').round().getInfo())

    all_dfs = []
    for chunk_start_offset, chunk_end_offset in chunk_offsets(total_months, chunk_months):
        chunk_start = start.advance(chunk_start_offset, 'month')
        chunk_end = start.advance(chunk_end_offset, 'month')

        chunk_start_str = chunk_start.format('YYYY-MM-dd').getInfo()
        chunk_end_str = chunk_end.format('YYYY-MM-dd').getInfo()
        log.info('Processing chunk: %s to %s ...', chunk_start_str, chunk_end_str)

        all_dfs.append(with_retries(
            lambda: aggregate_monthly(collection, geometry, chunk_start_str, chunk_end_str,
                                      bands, reducer, scale),
            max_retries=max_retries, sleep=sleep))
        # Pause between chunks so Earth Engine's concurrent-aggregation limit recovers.
        sleep(2)

    return pd.concat(all_dfs, ignore_index=True).sort_values('date').reset_index(drop=True)
