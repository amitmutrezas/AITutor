"""Deterministic band detection for metrics/bands.yaml. No model involved.

Reads readings (oldest first, newest last) as a JSON list on stdin and prints the tier the newest reading lands in.
Rules: 3 sigma above the mean, 2 sigma above, drift (4 of last 5 above 1 sigma, or 8 in a row above the mean), 1 sigma.
Only the high side counts, which suits error and failure rates.
"""
import json
import statistics
import sys

MIN_SIGMA = 0.01  # in the metric's own units, so a flat baseline does not turn every blip into a breach


def above(readings, line, need, out_of):
    return sum(r > line for r in readings[-out_of:]) >= need


def tier(readings):
    baseline = readings[:-1]
    if len(baseline) < 24:
        raise ValueError("need at least 24 baseline readings before the newest one")
    mean = statistics.mean(baseline)
    sigma = max(statistics.stdev(baseline), MIN_SIGMA)
    rules = [
        ("3sigma", "reading above 3 sigma", above(readings, mean + 3 * sigma, 1, 1)),
        ("2sigma", "reading above 2 sigma", above(readings, mean + 2 * sigma, 1, 1)),
        ("2sigma", "drift: 4 of 5 readings above 1 sigma", above(readings, mean + sigma, 4, 5)),
        ("2sigma", "drift: 8 readings in a row above the mean", above(readings, mean, 8, 8)),
        ("1sigma", "reading above 1 sigma", above(readings, mean + sigma, 1, 1)),
    ]
    for name, rule, tripped in rules:
        if tripped:
            return {"tier": name, "rule": rule, "reading": readings[-1], "mean": round(mean, 4), "sigma": round(sigma, 4)}
    return {"tier": "none", "reading": readings[-1], "mean": round(mean, 4), "sigma": round(sigma, 4)}


if __name__ == "__main__":
    try:
        print(json.dumps(tier(json.load(sys.stdin))))
    except ValueError as e:
        sys.exit(str(e))
