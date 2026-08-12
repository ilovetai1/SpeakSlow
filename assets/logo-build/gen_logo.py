from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent
SOURCE = HERE / "speakslow-logo-v2.png"
APP_ICON_1024 = HERE / "icon-1024.png"
PREVIEW = HERE / "preview.png"

ICONSET_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}


def resize(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


def save_rounded_line(draw, points, width):
    draw.line(points, fill=(0, 0, 0, 255), width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(0, 0, 0, 255))


def make_tray_template(size, dpi):
    # 高解析度先繪製再縮小，讓 16px 選單列圖示仍有平滑、清楚的邊緣。
    canvas_size = 256
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    save_rounded_line(
        draw,
        [(25, 70), (44, 54), (65, 89), (88, 38), (112, 90), (138, 61), (164, 76), (226, 76)],
        22,
    )
    save_rounded_line(
        draw,
        [(25, 128), (47, 110), (70, 143), (96, 105), (121, 141), (147, 116), (172, 128), (226, 128)],
        20,
    )
    save_rounded_line(
        draw,
        [(25, 186), (52, 165), (79, 190), (108, 157), (137, 184), (165, 166), (188, 178), (226, 178)],
        18,
    )
    output = resize(image, size)
    return output, {"dpi": (dpi, dpi), "optimize": True}


def save_tray_preview(template):
    preview = Image.new("RGB", (320, 160), (246, 246, 248))
    ImageDraw.Draw(preview).rectangle((160, 0, 319, 159), fill=(35, 37, 41))
    mask = resize(template.getchannel("A"), 96)
    dark_glyph = Image.new("RGB", (96, 96), (30, 30, 32))
    light_glyph = Image.new("RGB", (96, 96), (248, 248, 250))
    preview.paste(dark_glyph, (32, 32), mask)
    preview.paste(light_glyph, (192, 32), mask)
    preview.save(HERE / "tray-preview.png", optimize=True)


def build_icns(app_icon):
    with tempfile.TemporaryDirectory(prefix="speakslow-icon-") as temp_dir:
        iconset = Path(temp_dir) / "SpeakSlow.iconset"
        iconset.mkdir()
        for filename, size in ICONSET_SIZES.items():
            resize(app_icon, size).save(iconset / filename, optimize=True)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")],
            check=True,
        )


def main():
    source = Image.open(SOURCE).convert("RGBA")
    if source.width != source.height:
        raise ValueError(f"Logo source must be square, got {source.size}")

    app_icon = resize(source, 1024)
    app_icon.save(APP_ICON_1024, optimize=True)
    resize(app_icon, 512).save(ASSETS / "icon.png", optimize=True)
    resize(app_icon, 64).save(HERE / "speakslow-logo-v2-64.png", optimize=True)

    preview = Image.new("RGB", (1024, 1024), (245, 245, 248))
    preview.paste(app_icon, (0, 0), app_icon)
    preview.save(PREVIEW, optimize=True)

    app_icon.save(
        ASSETS / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    build_icns(app_icon)

    tray_1x, tray_1x_options = make_tray_template(16, 72)
    tray_2x, tray_2x_options = make_tray_template(32, 144)
    tray_1x.save(ASSETS / "speakslowTemplate.png", **tray_1x_options)
    tray_2x.save(ASSETS / "speakslowTemplate@2x.png", **tray_2x_options)
    save_tray_preview(tray_2x)

    print(f"Generated app icons from {SOURCE}")
    print(f"Generated macOS tray templates in {ASSETS}")


if __name__ == "__main__":
    main()
