#!/usr/bin/env python3
"""Regenerate LOLO web and Android image assets from preserved originals."""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets/branding"
PURPLE = (112, 63, 191)
RES = ROOT / "android-apk/android/app/src/main/res"


def source_image(filename):
    image = Image.open(BRAND / "original" / filename).convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    bounds = alpha.getbbox()
    return image.crop(bounds) if bounds else image


def fit(image, size, background=(0, 0, 0, 0), scale=1.0):
    width, height = size
    content = ImageOps.contain(image, (int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (width, height), background)
    canvas.alpha_composite(content, ((width - content.width) // 2, (height - content.height) // 2))
    return canvas


def main():
    icon = source_image("lolo-icon-original.png")
    logo = source_image("lolo-logo-original.png")
    (BRAND / "icons").mkdir(parents=True, exist_ok=True)
    (BRAND / "logos").mkdir(parents=True, exist_ok=True)
    icon.save(BRAND / "icons/lolo-icon.png", optimize=True)
    icon.save(BRAND / "icons/lolo-icon.webp", "WEBP", quality=92, method=6)
    logo.save(BRAND / "logos/lolo-logo.png", optimize=True)
    logo.save(BRAND / "logos/lolo-logo.webp", "WEBP", quality=92, method=6)
    for size in (16, 32, 48, 64, 96, 128, 192, 256, 512, 1024):
        fit(icon, (size, size)).save(BRAND / f"icons/icon-{size}.png", optimize=True)
    for size, filename in ((16, "favicon-16x16.png"), (32, "favicon-32x32.png"), (48, "favicon-48x48.png"), (180, "apple-touch-icon.png")):
        image = fit(icon, (size, size))
        image.save(ROOT / filename, optimize=True)
        image.save(BRAND / "favicon" / filename, optimize=True)
    fit(icon, (48, 48)).save(ROOT / "favicon.ico", format="ICO", sizes=((16, 16), (32, 32), (48, 48)))
    for size in (192, 512):
        maskable = fit(icon, (size, size), PURPLE + (255,), scale=0.68)
        maskable.save(BRAND / f"icons/icon-maskable-{size}.png", optimize=True)
        maskable.save(BRAND / f"icons/icon-{size}.png", optimize=True)
    for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        directory = RES / f"mipmap-{density}"
        directory.mkdir(parents=True, exist_ok=True)
        fit(icon, (size, size), PURPLE + (255,), scale=0.82).save(directory / "ic_launcher.png", optimize=True)
        fit(icon, (size, size), PURPLE + (255,), scale=0.82).save(directory / "ic_launcher_round.png", optimize=True)
        foreground_size = round(size * 2.25)
        fit(icon, (foreground_size, foreground_size), scale=0.62).save(directory / "ic_launcher_foreground.png", optimize=True)
    for splash in RES.glob("drawable*/splash.png"):
        original = Image.open(splash).convert("RGBA")
        width, height = original.size
        fit(icon, (width, height), (250, 248, 255, 255), scale=0.56).save(splash, optimize=True)
    ios = fit(icon, (1024, 1024), PURPLE + (255,), scale=0.82)
    ios.convert("RGB").save(BRAND / "ios/lolo-app-icon-1024.png", optimize=True)
    monochrome_source = source_image("lolo-icon-original.png")
    mono = Image.new("RGBA", (432, 432), (255, 255, 255, 0))
    mask = ImageOps.contain(monochrome_source, (270, 270), Image.Resampling.LANCZOS).getchannel("A")
    mono_layer = Image.new("RGBA", mask.size, (255, 255, 255, 0))
    mono_layer.putalpha(mask)
    mono.alpha_composite(mono_layer, ((432 - mask.width) // 2, (432 - mask.height) // 2))
    mono.save(RES / "drawable/ic_launcher_monochrome.png", optimize=True)


if __name__ == "__main__":
    main()
