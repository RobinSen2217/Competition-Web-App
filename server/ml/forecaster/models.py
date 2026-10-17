"""Model registry: request name -> human label + a factory for a fresh model.

Adding or replacing a model is one entry here. A factory takes the seed and
returns an unfitted object with scikit-learn's fit(X, y) / predict(X); the
pipeline does the rest (split, metrics, importance, hindcast, forecast). The
team's physics-informed network, for example, only needs a small wrapper class
with those two methods.

The three entries below are the notebook's make_models() (cell 54) verbatim.
Each sits behind a StandardScaler because the inputs mix units (mm, °C, W/m²).
"""

from dataclasses import dataclass
from typing import Callable

from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


@dataclass(frozen=True)
class ModelSpec:
    label: str
    factory: Callable[[int], object]


MODELS = {
    'ridge': ModelSpec(
        label='Ridge regression',
        factory=lambda seed: make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
    ),
    'nn': ModelSpec(
        label='Neural network',
        factory=lambda seed: make_pipeline(StandardScaler(), MLPRegressor(
            hidden_layer_sizes=(8, 8), activation='tanh', alpha=1e-1,
            solver='lbfgs', max_iter=2000, random_state=seed)),
    ),
    'gbm': ModelSpec(
        label='Gradient boosting',
        factory=lambda seed: make_pipeline(StandardScaler(), GradientBoostingRegressor(
            n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=seed)),
    ),
}
