#!/usr/bin/env python3
"""te-snap: render HTML through WebKitGTK and work with the resulting pictures.

Subcommands (all print one JSON object on stdout):
  render  --html FILE --out PNG --width CSSPX [--height CSSPX] [--viewport] [--backend x11|wayland] [--metrics JSON]
  crop    --in PNG --out PNG --x X --y Y --w W --h H
  diff    --a PNG --b PNG [--out PNG]
  marks   --in PNG --out PNG [--color ff00ff]

`render` uses the same engine as the app (WebKitGTK 4.1) and snapshots the full
document, so the picture is what the editor shows, independent of the window.
Run with `python3 -I` to keep the interpreter isolated from the current directory.
"""
import argparse
import json
import os
import sys

# WebKitGTK needs this on Wayland sessions for offscreen GL surfaces.
os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def cmd_render(args):
    if args.backend:
        os.environ["GDK_BACKEND"] = args.backend
    import gi  # type: ignore

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import GLib, Gtk, WebKit2  # type: ignore

    width = int(args.width)
    height = int(args.height or 800)
    result = {"ok": False}
    state = {"attempts": 0}

    window = Gtk.OffscreenWindow()
    view = WebKit2.WebView()
    settings = view.get_settings()
    settings.set_enable_developer_extras(False)
    settings.set_allow_file_access_from_file_urls(True)
    settings.set_allow_universal_access_from_file_urls(True)
    window.add(view)
    window.set_default_size(width, height)
    window.show_all()

    probe_js = (
        "JSON.stringify({dpr: window.devicePixelRatio, innerWidth: window.innerWidth,"
        " innerHeight: window.innerHeight, docWidth: document.documentElement.scrollWidth,"
        " docHeight: document.documentElement.scrollHeight})"
    )

    def fail(message):
        result.update({"ok": False, "error": message})
        Gtk.main_quit()

    def snapshot(metrics):
        region = WebKit2.SnapshotRegion.VISIBLE if args.viewport else WebKit2.SnapshotRegion.FULL_DOCUMENT

        def done(v, res):
            try:
                surface = v.get_snapshot_finish(res)
                surface.write_to_png(args.out)
                result.update(
                    {
                        "ok": True,
                        "path": args.out,
                        "width": surface.get_width(),
                        "height": surface.get_height(),
                        "metrics": metrics,
                        "attempts": state["attempts"],
                    }
                )
                if args.metrics:
                    with open(args.metrics, "w", encoding="utf-8") as handle:
                        json.dump(result, handle, indent=2)
            except Exception as error:  # noqa: BLE001
                result.update({"ok": False, "error": str(error)})
            Gtk.main_quit()

        view.get_snapshot(region, WebKit2.SnapshotOptions.NONE, None, done)

    def measured(v, res):
        try:
            value = v.evaluate_javascript_finish(res)
            metrics = json.loads(value.to_string())
        except Exception as error:  # noqa: BLE001
            fail(f"probe failed: {error}")
            return
        state["attempts"] += 1
        # The GTK window size is in GTK pixels; WebKit may apply a scale (fractional
        # DPI on X11) so one correction pass makes innerWidth match the requested CSS width.
        if metrics["innerWidth"] != width and state["attempts"] < 4:
            # GTK pixels per CSS pixel on this backend (1 on Wayland, Xft.dpi/96 on X11).
            factor = float(max(1, view.get_allocated_width())) / float(max(1, metrics["innerWidth"]))
            new_w = max(1, int(round(width * factor)))
            new_h = max(1, int(round(height * factor)))
            view.set_size_request(new_w, new_h)
            window.resize(new_w, new_h)
            GLib.timeout_add(200, lambda: (probe(), False)[1])
            return
        GLib.timeout_add(100, lambda: (snapshot(metrics), False)[1])

    def probe():
        view.evaluate_javascript(probe_js, -1, None, None, None, measured)

    def on_load(v, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(200, lambda: (probe(), False)[1])

    def on_failed(v, event, uri, error):
        fail(f"load failed for {uri}: {error}")
        return True

    view.connect("load-changed", on_load)
    view.connect("load-failed", on_failed)
    view.load_uri("file://" + os.path.abspath(args.html))
    GLib.timeout_add_seconds(int(args.timeout), lambda: (fail("timeout"), False)[1])
    Gtk.main()
    out(result)
    return 0 if result.get("ok") else 1


def cmd_crop(args):
    from PIL import Image  # type: ignore

    image = Image.open(args.input)
    x, y, w, h = (int(round(float(v))) for v in (args.x, args.y, args.w, args.h))
    x = max(0, min(x, image.width))
    y = max(0, min(y, image.height))
    x2 = max(x, min(x + w, image.width))
    y2 = max(y, min(y + h, image.height))
    image.crop((x, y, x2, y2)).save(args.out)
    out({"ok": True, "path": args.out, "x": x, "y": y, "width": x2 - x, "height": y2 - y})
    return 0


def cmd_diff(args):
    from PIL import Image, ImageChops  # type: ignore

    a = Image.open(args.a).convert("RGB")
    b = Image.open(args.b).convert("RGB")
    width = min(a.width, b.width)
    height = min(a.height, b.height)
    same_size = a.size == b.size
    a = a.crop((0, 0, width, height))
    b = b.crop((0, 0, width, height))
    delta = ImageChops.difference(a, b)
    bbox = delta.getbbox()
    mismatch = 0
    if bbox:
        mask = delta.convert("L").point(lambda v: 255 if v > int(args.tolerance) else 0)
        mismatch = mask.histogram()[255]
        if args.out:
            mask.save(args.out)
    total = width * height
    out(
        {
            "ok": True,
            "width": width,
            "height": height,
            "sameSize": same_size,
            "sizeA": list(Image.open(args.a).size),
            "sizeB": list(Image.open(args.b).size),
            "mismatch": mismatch,
            "mismatchPct": (100.0 * mismatch / total) if total else 0.0,
            "bbox": list(bbox) if bbox else None,
            "diffPath": args.out if (args.out and bbox) else None,
        }
    )
    return 0


def cmd_marks(args):
    from PIL import Image  # type: ignore

    image = Image.open(args.input).convert("RGB")
    target = tuple(int(args.color[i : i + 2], 16) for i in (0, 2, 4))
    tolerance = int(args.tolerance)
    pixels = image.load()
    min_x = min_y = None
    max_x = max_y = None
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = pixels[x, y]
            if abs(r - target[0]) <= tolerance and abs(g - target[1]) <= tolerance and abs(b - target[2]) <= tolerance:
                if min_x is None or x < min_x:
                    min_x = x
                if max_x is None or x > max_x:
                    max_x = x
                if min_y is None or y < min_y:
                    min_y = y
                if max_y is None or y > max_y:
                    max_y = y
    if min_x is None:
        out({"ok": False, "error": "no registration marks found"})
        return 1
    # Thickness of the frame: walk inward from the left edge on the middle row.
    mid_y = (min_y + max_y) // 2
    thickness = 0
    x = min_x
    while x <= max_x:
        r, g, b = pixels[x, mid_y]
        if abs(r - target[0]) <= tolerance and abs(g - target[1]) <= tolerance and abs(b - target[2]) <= tolerance:
            thickness += 1
            x += 1
        else:
            break
    thickness = max(1, thickness)
    inner = (min_x + thickness, min_y + thickness, max_x + 1 - thickness, max_y + 1 - thickness)
    outer = (min_x, min_y, max_x + 1, max_y + 1)
    image.crop(outer if args.region == "outer" else inner).save(args.out)
    out(
        {
            "ok": True,
            "path": args.out,
            "region": args.region,
            "frame": {"x": min_x, "y": min_y, "width": max_x + 1 - min_x, "height": max_y + 1 - min_y, "thickness": thickness},
            "inner": {"x": inner[0], "y": inner[1], "width": inner[2] - inner[0], "height": inner[3] - inner[1]},
        }
    )
    return 0


def main(argv):
    parser = argparse.ArgumentParser(prog="te-snap")
    sub = parser.add_subparsers(dest="command", required=True)

    render = sub.add_parser("render")
    render.add_argument("--html", required=True)
    render.add_argument("--out", required=True)
    render.add_argument("--width", required=True)
    render.add_argument("--height")
    render.add_argument("--viewport", action="store_true", help="snapshot only the visible area instead of the full document")
    render.add_argument("--backend", choices=["x11", "wayland"])
    render.add_argument("--metrics")
    render.add_argument("--timeout", default="30")
    render.set_defaults(func=cmd_render)

    crop = sub.add_parser("crop")
    crop.add_argument("--in", dest="input", required=True)
    crop.add_argument("--out", required=True)
    for name in ("x", "y", "w", "h"):
        crop.add_argument(f"--{name}", required=True)
    crop.set_defaults(func=cmd_crop)

    diff = sub.add_parser("diff")
    diff.add_argument("--a", required=True)
    diff.add_argument("--b", required=True)
    diff.add_argument("--out")
    diff.add_argument("--tolerance", default="0")
    diff.set_defaults(func=cmd_diff)

    marks = sub.add_parser("marks")
    marks.add_argument("--in", dest="input", required=True)
    marks.add_argument("--out", required=True)
    marks.add_argument("--color", default="ff00ff")
    marks.add_argument("--tolerance", default="40")
    marks.add_argument("--region", choices=["outer", "inner"], default="outer")
    marks.set_defaults(func=cmd_marks)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as error:  # noqa: BLE001
        out({"ok": False, "error": f"{type(error).__name__}: {error}"})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
