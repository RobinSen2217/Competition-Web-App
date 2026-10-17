"""A tiny numeric stand-in for ee.Image, enough to run forecaster.gee.scaling.

Bands are numpy arrays (one value per pixel). Operations follow Earth
Engine's rules where the scaling code relies on them: band-wise maths between
images with the same number of bands (or one band broadcast), select with new
names, masked pixels as NaN, and addBands appending bands.
"""

import numpy as np


class FakeImage:
    def __init__(self, bands, props=None):
        self.bands = {k: np.asarray(v, dtype='float64') for k, v in bands.items()}
        self.props = dict(props or {})

    @staticmethod
    def constant(values):
        values = values if isinstance(values, (list, tuple)) else [values]
        return FakeImage({f'constant_{i}': [v] for i, v in enumerate(values)})

    # band access
    def select(self, names, new_names=None):
        names = [names] if isinstance(names, str) else list(names)
        new_names = names if new_names is None else list(new_names)
        return FakeImage({n: self.bands[o] for o, n in zip(names, new_names)}, self.props)

    def rename(self, names):
        names = [names] if isinstance(names, str) else list(names)
        assert len(names) == len(self.bands), 'rename needs one name per band'
        return FakeImage(dict(zip(names, self.bands.values())), self.props)

    def addBands(self, imgs):
        imgs = imgs if isinstance(imgs, list) else [imgs]
        bands = dict(self.bands)
        for img in imgs:
            bands.update(img.bands)
        return FakeImage(bands, self.props)

    def copyProperties(self, source, props):
        return FakeImage(self.bands, {**self.props, **{p: source.props.get(p) for p in props}})

    # maths
    def _op(self, other, fn):
        if isinstance(other, FakeImage):
            ov = list(other.bands.values())
            if len(ov) == 1:
                ov = ov * len(self.bands)
            assert len(ov) == len(self.bands), 'band counts differ'
            return FakeImage({k: fn(v, o) for (k, v), o in zip(self.bands.items(), ov)}, self.props)
        return FakeImage({k: fn(v, other) for k, v in self.bands.items()}, self.props)

    def multiply(self, x):
        return self._op(x, lambda a, b: a * b)

    def add(self, x):
        return self._op(x, lambda a, b: a + b)

    def subtract(self, x):
        return self._op(x, lambda a, b: a - b)

    def pow(self, x):
        return self._op(x, lambda a, b: a ** b)

    def sqrt(self):
        return FakeImage({k: np.sqrt(v) for k, v in self.bands.items()}, self.props)

    def toFloat(self):
        return FakeImage({k: v.astype('float32').astype('float64') for k, v in self.bands.items()}, self.props)

    def bitwiseAnd(self, x):
        return self._op(x, lambda a, b: (a.astype('int64') & int(b)).astype('float64'))

    def eq(self, x):
        return self._op(x, lambda a, b: (a == b).astype('float64'))

    def updateMask(self, mask):
        m = list(mask.bands.values())[0]
        return FakeImage({k: np.where(m != 0, v, np.nan) for k, v in self.bands.items()}, self.props)

    def normalizedDifference(self, names):
        a, b = self.bands[names[0]], self.bands[names[1]]
        return FakeImage({'nd': (a - b) / (a + b)}, self.props)

    def value(self, band):
        return self.bands[band]
