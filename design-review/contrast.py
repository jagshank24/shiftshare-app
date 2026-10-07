"""WCAG contrast audit of the Carnival palette pairings used in components."""

def srgb_to_lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(hexstr):
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb_to_lin(r) + 0.7152 * srgb_to_lin(g) + 0.0722 * srgb_to_lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

NAVY, ACCENT, CORAL, MINT, CREAM = "#1B2A49", "#FFC93C", "#FF6B6B", "#2EC4B6", "#FAF8F3"
WHITE = "#FFFFFF"

pairs = [
    ("body text: navy-900 on cream-200", NAVY, CREAM, 4.5),
    ("navy-600 on cream-200 (muted)", "#31415F", CREAM, 4.5),
    ("navy-400 on cream-200 (subtle/placeholder)", "#6E7CA1", CREAM, 3.0),
    ("button: navy-900 on accent-500 (primary)", NAVY, ACCENT, 4.5),
    ("button: cream-200 on navy-900 (secondary)", CREAM, NAVY, 4.5),
    ("button: cream-50 on coral-700 (danger)", "#FFFFFF", "#C93A3A", 4.5),
    ("button: navy-900 on mint-500 (success)", NAVY, MINT, 4.5),
    ("badge accent soft: accent-900 on accent-100", "#7C580E", "#FFF3D0", 4.5),
    ("badge coral soft: coral-800 on coral-100", "#A32C2C", "#FFE1E1", 4.5),
    ("badge mint soft: mint-800 on mint-100", "#17635D", "#D0F5F1", 4.5),
    ("badge navy soft: navy-800 on navy-100", "#1F3054", "#E6EAF3", 4.5),
    ("badge neutral soft: navy-700 on cream-300", "#22345C", "#F2EEE4", 4.5),
    ("error text: coral-700 on cream-200", "#C93A3A", CREAM, 4.5),
    ("inverse card body: navy-200 on navy-900", "#CBD3E6", NAVY, 4.5),
    ("focus ring navy-900 vs cream-200 (non-text)", NAVY, CREAM, 3.0),
    ("focus ring accent-500 vs navy-900 (non-text)", ACCENT, NAVY, 3.0),
    ("-- informational (not required to pass) --", None, None, None),
    ("accent-500 on cream (decorative fill only)", ACCENT, CREAM, 3.0),
    ("coral-500 on cream (alert border only)", CORAL, CREAM, 3.0),
    ("mint-500 on cream (success fill only)", MINT, CREAM, 3.0),
]

print(f"{'pairing':52} {'ratio':>6}  target  result")
print("-" * 82)
for name, fg, bg, target in pairs:
    if fg is None:
        print(f"\n{name}")
        continue
    r = ratio(fg, bg)
    print(f"{name:52} {r:5.2f}:1  {target:4.1f}   {'PASS' if r >= target else 'FAIL'}")
