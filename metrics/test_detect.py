import unittest
from detect import tier

BASE = [0.2, 0.22, 0.18, 0.21, 0.19, 0.2] * 5  # 30 readings, mean about 0.2


class DetectTests(unittest.TestCase):
    def test_quiet(self):
        self.assertEqual(tier(BASE + [0.2])["tier"], "none")

    def test_spike(self):
        self.assertEqual(tier(BASE + [1.9])["tier"], "3sigma")

    def test_drift(self):
        self.assertEqual(tier(BASE + [0.201] * 8)["tier"], "2sigma")

    def test_short_baseline(self):
        with self.assertRaises(ValueError):
            tier([0.1] * 5)


if __name__ == "__main__":
    unittest.main()
