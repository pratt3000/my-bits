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
    # A path that already exists is taken as-is, so a bundle you have on disk can
    # be re-analysed without going back to the network.
    if os.path.exists(url):
        data = open(url, "rb").read()
        if os.path.abspath(url) != os.path.abspath(dest):
            open(dest, "wb").write(data)
        return len(data)
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


def find_blockers(html, game, markup):
    """
    Things that make a faithful port impossible, as opposed to merely laborious.

    The distinction matters because the response is different. Laborious is your
    problem: inline the CSS, rebuild the slider, get on with it. Impossible is
    the creator's decision, because the only ways past it are to substitute
    something of your own or to drop a feature — and both mean the result is no
    longer the thing they made. Quietly picking either one is not a port.

    "hard" is a stop. "check" means look it up before assuming either way.
    """
    hard, check = [], []

    # Packaged assets are disabled outright (maxAssets: 0), so any real file the
    # game ships — an image, a sample, a font — has nowhere to live in a bit.
    for cat in ("images", "videos", "music", "sfx", "fonts", "models", "voices"):
        m = re.search(cat + r"\s*:\s*\[(.*?)\]", game, re.S)
        if m and m.group(1).strip():
            n = m.group(1).count("{") or 1
            hard.append(("%d %s in the asset manifest" % (n, cat),
                         "packaged assets are disabled (maxAssets: 0)"))

    media = re.findall(r"<(?:img|audio|video|source)[^>]*src=\"(?!data:)([^\"]+)\"", html)
    if media:
        hard.append(("%d media file(s) referenced in markup: %s" %
                     (len(media), ", ".join(sorted(set(media))[:3])),
                     "no packaged assets and no network egress"))

    css_urls = [u for u in re.findall(r"url\(\s*['\"]?(?!data:)([^)'\"]+)", html)]
    if css_urls:
        hard.append(("%d file(s) referenced from CSS: %s" %
                     (len(css_urls), ", ".join(sorted(set(css_urls))[:3])),
                     "no packaged assets"))

    if re.search(r"@font-face|fonts\.googleapis\.com", html):
        hard.append(("a web font is loaded",
                     "fonts must come from Plethora's font registry, or be dropped"))

    calls = re.findall(r"fetch\(\s*[`'\"](https?://[^`'\"]+)", game) + \
            (["XMLHttpRequest"] if "XMLHttpRequest" in game else []) + \
            (["WebSocket"] if "WebSocket" in game else [])
    if calls:
        hard.append(("talks to a server: %s" % ", ".join(sorted(set(calls))[:3]),
                     "no http egress, and the server half of the code is not in this bundle"))

    # Libraries are only a problem if Plethora has not pinned them.
    REPLACEABLE = ("tailwindcss", "lucide", "font-awesome", "feather")
    for url in re.findall(r"<script[^>]*src=\"(https?://[^\"]+)\"", html):
        if not any(r in url for r in REPLACEABLE):
            check.append(("third-party library: %s" % url,
                          "check /v1/agent/libraries.json for an approved pin"))

    return hard, check


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
    hard, check = find_blockers(html, game, markup)

    if hard:
        # Written to disk as well as printed, so the decision is on the record
        # even if this output scrolls away.
        with open(os.path.join(out, "BLOCKERS.md"), "w", encoding="utf-8") as f:
            f.write("# Hard constraints found in %s\n\n" % game_url)
            f.write("A faithful port is not possible without a decision from the creator.\n\n")
            for what, why in hard:
                f.write("- **%s** — %s\n" % (what, why))
            if check:
                f.write("\n## Needs checking\n\n")
                for what, why in check:
                    f.write("- %s — %s\n" % (what, why))
            f.write("\nAsk before building. Do not substitute your own assets, and do not\n"
                    "drop the feature that needs them, without the creator choosing that.\n")

    # Persist before reporting: piping this into head or less should never cost
    # you the inventory the next step reads.
    json.dump({
        "sourceUrl": url, "gameUrl": game_url, "bytes": size,
        "inlineScripts": [{"file": n, "chars": c, "lines": l} for n, c, l in written],
        "external": external, "scaffolding": {k: v for k, v in scaffolding.items() if v},
        "icons": sorted(set(icons)),
        "dataAttributes": dict(data_attrs),
        "blockers": [{"what": w, "why": y} for w, y in hard],
        "needsChecking": [{"what": w, "why": y} for w, y in check],
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

    if check:
        print("\nneeds checking before you rely on it:")
        for what, why in check:
            print("   %s\n     -> %s" % (what, why))

    if hard:
        print("\n" + "=" * 72)
        print("STOP — HARD CONSTRAINTS. A faithful port is not possible as-is:")
        for what, why in hard:
            print("   %s\n     -> %s" % (what, why))
        print("")
        print("Ask the creator whether to continue, and how, before building anything.")
        print("Substituting your own assets or dropping the feature that needs them is")
        print("their call, not yours — either way the result stops being the thing they")
        print("made, and they are the only one who can say that is acceptable.")
        print("Written to %s/BLOCKERS.md" % out)
        print("=" * 72)

    print("\nwritten to %s/ — read game.js before porting anything" % out)


if __name__ == "__main__":
    main()
