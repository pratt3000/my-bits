#!/usr/bin/env python3
"""
Recover the source of a Sekai game from its play link.

    python3 grab.py <play-url-or-dist-url> [outdir]

A Sekai play page is a Next.js shell; the game itself is a single self-contained
HTML file whose address is buried in the page's flight data under "gameUrl".
This finds it, downloads it, and splits it into the parts you actually need to
read: the inline scripts, the stylesheet, and the markup with the scripts taken
out.

It also prints an inventory — what the page loads from a CDN, what platform
scaffolding is wrapped around the game, and any repeated data-* elements (on a
Sekai build these are usually the mode buttons and their icons). That inventory
is the porting brief: everything in it either has to be inlined, dropped, or
rebuilt, because a Plethora bit cannot load anything off the network.
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter

UA = "Mozilla/5.0 (compatible; bit-porter/1.0)"


def fetch(url, dest):
    r = subprocess.run(
        ["curl", "-sSL", "-A", UA, "-o", dest, "-w", "%{http_code} %{size_download}", url],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit("curl failed for %s: %s" % (url, r.stderr.strip()))
    code, size = (r.stdout.split() + ["?", "?"])[:2]
    if code != "200":
        sys.exit("HTTP %s fetching %s" % (code, url))
    return int(size)


def find_game_url(html):
    """The bundle address, however the shell happens to have escaped it."""
    for pat in (r'\\"gameUrl\\":\\"([^"\\]+)\\"',      # inside escaped flight data
                r'"gameUrl"\s*:\s*"([^"]+)"',           # plain JSON
                r'(https://[a-z0-9.-]*sekai[a-z0-9.-]*/[^"\'\\ ]*/index\.html)'):
        m = re.search(pat, html)
        if m:
            return m.group(1).replace("\\u002F", "/").replace("\\/", "/")
    return None


def dedent(text):
    lines = text.split("\n")
    body = [l for l in lines[1:] if l.strip()]
    if not body:
        return text
    pad = min(len(l) - len(l.lstrip()) for l in body)
    return "\n".join([lines[0]] + [(l[pad:] if l.strip() else "") for l in lines[1:]])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    url = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "recovered"
    os.makedirs(out, exist_ok=True)

    if url.endswith(".html"):
        game_url = url
    else:
        page = os.path.join(out, "play-page.html")
        fetch(url, page)
        html = open(page, encoding="utf-8", errors="replace").read()
        game_url = find_game_url(html)
        if not game_url:
            sys.exit("no gameUrl in the play page — open %s and look for the bundle by hand" % page)
        title = re.search(r"<title>([^<]*)</title>", html)
        if title:
            print("title      :", title.group(1).strip())
    print("game bundle:", game_url)

    src = os.path.join(out, "original.html")
    size = fetch(game_url, src)
    html = open(src, encoding="utf-8", errors="replace").read()
    print("downloaded :", size, "bytes")

    # --- split it up -------------------------------------------------------
    scripts = re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S)
    inline = [(a, b) for a, b in scripts if b.strip()]
    external = [re.search(r'src="([^"]+)"', a).group(1)
                for a, b in scripts if "src=" in a]
    styles = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)

    inline.sort(key=lambda ab: -len(ab[1]))
    written = []
    for i, (_attrs, body) in enumerate(inline):
        name = "game.js" if i == 0 else "inline-%d.js" % i
        path = os.path.join(out, name)
        open(path, "w", encoding="utf-8").write(dedent(body.strip()) + "\n")
        written.append((name, len(body), body.count("\n") + 1))

    if styles:
        open(os.path.join(out, "styles.css"), "w", encoding="utf-8").write(
            "\n".join(s.strip() for s in styles) + "\n")

    markup = re.sub(r"<script.*?</script>", "", html, flags=re.S)
    markup = re.sub(r"<style.*?</style>", "", markup, flags=re.S)
    open(os.path.join(out, "markup.html"), "w", encoding="utf-8").write(markup)

    # --- the porting brief -------------------------------------------------
    game = open(os.path.join(out, "game.js"), encoding="utf-8").read() if written else ""
    scaffolding = {
        "sekaiEditable metadata": "sekaiEditable" in game,
        "postMessage editing API": "postMessage" in game,
        "audio-unlock shim": any("unlockAudio" in b for _a, b in inline),
        "DOMContentLoaded boot": "DOMContentLoaded" in game,
        "requestAnimationFrame loop": "requestAnimationFrame" in game,
        "getBoundingClientRect": "getBoundingClientRect" in game,
        "window.* globals": len(re.findall(r"\bwindow\.\w+", game)),
    }
    data_attrs = Counter(re.findall(r"\b(data-[a-z-]+)=", html))
    icons = re.findall(r'data-lucide="([a-z0-9-]+)"', html)

    # Persist before reporting: piping this into head or less should never cost
    # you the inventory the next step reads.
    json.dump({
        "sourceUrl": url, "gameUrl": game_url, "bytes": size,
        "inlineScripts": [{"file": n, "chars": c, "lines": l} for n, c, l in written],
        "external": external, "scaffolding": {k: v for k, v in scaffolding.items() if v},
        "icons": sorted(set(icons)),
        "dataAttributes": dict(data_attrs),
    }, open(os.path.join(out, "inventory.json"), "w"), indent=2)

    print("\ninline scripts (largest first — the first is the game):")
    for name, chars, lines in written:
        print("  %-14s %6d chars  %4d lines" % (name, chars, lines))
    if styles:
        print("  %-14s %6d chars" % ("styles.css", sum(len(s) for s in styles)))

    print("\nloaded from the network (must be inlined or dropped — bits have no CDN):")
    for e in external or ["  (none)"]:
        print("  ", e)

    print("\nplatform scaffolding and things the bit contract replaces:")
    for k, v in scaffolding.items():
        if v:
            print("   %-28s %s" % (k, v if v is not True else "yes"))

    if data_attrs:
        print("\nrepeated elements (usually the control inventory to rebuild):")
        for k, n in data_attrs.most_common(8):
            print("   %-18s x%d" % (k, n))
    if icons:
        print("\nlucide icons used (%d, %d distinct) — run scripts/icons.js to inline them:"
              % (len(icons), len(set(icons))))
        print("  ", " ".join(sorted(set(icons))))

    print("\nwritten to %s/ — read game.js before porting anything" % out)


if __name__ == "__main__":
    main()
