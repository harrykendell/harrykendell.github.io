from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

root = Path(__file__).parent
out_dir = root
out_dir.mkdir(parents=True, exist_ok=True)
logo_svg_path = root / "logo.svg"

SOURCE_SIZE = 1024
SPLASH_BG_COLOR = "#00491e"
APPLE_TOUCH_SIZE = 180
APPLE_TOUCH_PADDING_LEFT = 5
APPLE_TOUCH_PADDING_TOP = 10
APPLE_TOUCH_PADDING_RIGHT = 10
APPLE_TOUCH_PADDING_BOTTOM = 5

def render_logo(size: int, *, hide_splash_bg: bool, hide_splash_border: bool = False) -> Image.Image:
    svg_text = logo_svg_path.read_text(encoding="utf-8")
    if hide_splash_bg:
        # Splash screens already paint their own green canvas.
        svg_text = svg_text.replace(
            'id="splash-bg"',
            'id="splash-bg" display="none"',
        )
    if hide_splash_border:
        svg_text = svg_text.replace(
            'id="splash-bg-border"',
            'id="splash-bg-border" display="none"',
        )

    png_bytes = cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        output_width=size,
        output_height=size,
    )
    return Image.open(BytesIO(png_bytes)).convert("RGBA")


source = render_logo(SOURCE_SIZE, hide_splash_bg=True)
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
    canvas = Image.new("RGBA", (width, height), SPLASH_BG_COLOR)

    symbol_scale = 0.29 if width < height else 0.23
    target = int(min(width, height) * symbol_scale)
    target = max(180, min(700, target))
    symbol_resized = symbol.resize((target, target), Image.Resampling.LANCZOS)

    x = (width - target) // 2
    y = (height - target) // 2
    canvas.alpha_composite(symbol_resized, (x, y))

    out_path = out_dir / f"apple-splash-{width}-{height}.png"
    canvas.convert("RGB").save(out_path, format="PNG", optimize=True)

touch_path = out_dir / "apple-touch-icon.png"
touch_canvas = Image.new("RGBA", (APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE), SPLASH_BG_COLOR)
touch_inner = APPLE_TOUCH_SIZE - APPLE_TOUCH_PADDING_LEFT - APPLE_TOUCH_PADDING_RIGHT
touch_icon = render_logo(touch_inner, hide_splash_bg=False, hide_splash_border=True)
touch_canvas.alpha_composite(touch_icon, (APPLE_TOUCH_PADDING_LEFT, APPLE_TOUCH_PADDING_TOP))
touch_canvas.convert("RGB").save(touch_path, format="PNG", optimize=True)

print(f"generated {len(sizes)} startup images + apple-touch-icon.png")
