from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

root = Path(__file__).parent
out_dir = root
out_dir.mkdir(parents=True, exist_ok=True)

SOURCE_SIZE = 1024

def load_logo_image() -> Image.Image:
    svg_path = root / "logo.svg"

    # Keep the editable green bg in logo.svg, but hide it for splash symbol extraction.
    svg_text = svg_path.read_text(encoding="utf-8").replace(
        'id="splash-bg"',
        'id="splash-bg" display="none"',
    )
    png_bytes = cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        output_width=SOURCE_SIZE,
        output_height=SOURCE_SIZE,
    )
    return Image.open(BytesIO(png_bytes)).convert("RGBA")


source = load_logo_image()
symbol = source

specs = [
    # iPhone portrait+landscape
    (320, 568, 2),
    (375, 667, 2),
    (414, 736, 3),
    (375, 812, 3),
    (414, 896, 2),
    (414, 896, 3),
    (360, 780, 3),
    (390, 844, 3),
    (393, 852, 3),
    (428, 926, 3),
    (430, 932, 3),
    # iPad portrait+landscape
    (744, 1133, 2),
    (768, 1024, 2),
    (834, 1112, 2),
    (834, 1194, 2),
    (1024, 1366, 2),
]

sizes = set()
for w, h, scale in specs:
    sizes.add((w * scale, h * scale))
    sizes.add((h * scale, w * scale))

for width, height in sorted(sizes):
    canvas = Image.new("RGBA", (width, height), "#00491e")

    symbol_scale = 0.29 if width < height else 0.23
    target = int(min(width, height) * symbol_scale)
    target = max(180, min(700, target))
    symbol_resized = symbol.resize((target, target), Image.Resampling.LANCZOS)

    x = (width - target) // 2
    y = (height - target) // 2
    canvas.alpha_composite(symbol_resized, (x, y))

    out_path = out_dir / f"apple-splash-{width}-{height}.png"
    canvas.convert("RGB").save(out_path, format="PNG", optimize=True)

print(f"generated {len(sizes)} startup images")
