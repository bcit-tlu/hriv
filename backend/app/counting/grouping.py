"""Appearance grouping for counted objects (#1662 spike port: grouping3).

GaussianMixture + BIC in a fixed, physically scaled feature space —
``[log(area)/ln(2.5), a*/10, b*/10]`` — then union-merge components whose
means are closer than one unit. Fixed scales (not StandardScaler) stop
homogeneous fields from being stretched until noise looks like structure.
"""

from __future__ import annotations

from typing import Any

import numpy as np

AREA_UNIT = np.log(2.5)
CHROMA_UNIT = 10.0
MERGE_DIST = 1.0
K_MAX = 6
_MIN_FOR_GMM = 4


def _merge_labels(pred: np.ndarray, Z: np.ndarray) -> np.ndarray:
    """Union-merge GMM components closer than MERGE_DIST in scaled space."""
    comps = sorted(set(pred.tolist()))
    means = {c: Z[pred == c].mean(axis=0) for c in comps}
    parent = {c: c for c in comps}

    def find(c: int) -> int:
        while parent[c] != c:
            c = parent[c]
        return c

    for i, a in enumerate(comps):
        for b in comps[i + 1:]:
            if np.linalg.norm(means[a] - means[b]) < MERGE_DIST:
                parent[find(b)] = find(a)
    return np.array([find(c) for c in pred])


def assign_groups(objects: list[dict[str, Any]]) -> list[int]:
    """Return group ids (ints) in object order — NOT yet re-indexed."""
    if not objects:
        return []
    X = np.array([[np.log(o["area"]), o["a"], o["b"]] for o in objects])
    Z = np.column_stack(
        [X[:, 0] / AREA_UNIT, X[:, 1] / CHROMA_UNIT, X[:, 2] / CHROMA_UNIT]
    )
    if len(Z) < _MIN_FOR_GMM:
        return [0] * len(Z)
    from sklearn.mixture import GaussianMixture

    fits = [
        GaussianMixture(
            k, covariance_type="full", random_state=0, n_init=2, reg_covar=1e-2
        ).fit(Z)
        for k in range(1, min(K_MAX, len(Z) - 1) + 1)
    ]
    best = min(fits, key=lambda m: m.bic(Z))
    merged = _merge_labels(best.predict(Z), Z)
    return [int(v) for v in merged]
