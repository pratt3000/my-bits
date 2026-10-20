#!/usr/bin/env python3
"""
Find what the upload validator's source scan is rejecting, by delta debugging.

    python3 bisect.py <path/to/bit-dir>

The validator reports almost every source problem as "unsupported remote
resources", which names nothing. A rejected upload creates nothing, so probing
is free. Two things learned the hard way shape the method:

- Probes must PARSE. A slice cut mid-function only gets a lenient text scan
  and comes back clean, which makes a line-range bisect report "fails only
  together" everywhere. So the unit of removal is a whole top-level statement
  of init(ctx): a declaration at four-space indent and everything up to the
  next one. Removing any set of those keeps the source valid.
- Every probe renames `window.plethoraBit`, so a source that clears the scan
  fails the later "must assign window.plethoraBit" check and never becomes a
  draft.

The search is ddmin: drop halves of the statement list while the rest still
fails, raising the granularity when nothing can be dropped, until the set of
statements whose presence is needed for the rejection is 1-minimal. A trigger
that is a combination (a gradient plus an unresolvable stop) comes out as two
statements.

Needs a saved agent token (see upload.py pair).
"""
import json
import os
import re
import subprocess
import sys
import time

API = "https://api.plethora.studio/v1/agent"
TOKEN_PATH = os.path.expanduser("~/.plethora/agent-token.json")


def token():
    if os.environ.get("PLETHORA_AGENT_TOKEN"):
        return os.environ["PLETHORA_AGENT_TOKEN"]
    return json.load(open(TOKEN_PATH))["accessToken"]


def probe(manifest, source):
    body = {"title": manifest["title"], "description": manifest.get("description", ""),
            "tags": manifest.get("tags", []), "source": source, "manifest": manifest, "generated": True}
    r = subprocess.run(["curl", "-sS", "-X", "POST", API + "/bits/drafts",
                        "-H", "Content-Type: application/json",
                        "-H", "Authorization: Plethora-Agent " + token(),
                        "--data-binary", "@-"], input=json.dumps(body), capture_output=True, text=True)
    try:
        res = json.loads(r.stdout)
    except Exception:
        return "unparseable: " + r.stdout[:200]
    if res.get("ok"):
        return "CREATED " + str((res.get("data") or {}).get("bit", {}).get("id"))
    msg = (res.get("error") or {}).get("message", json.dumps(res))
    if "remote resources" in msg:
        return "scan"
    return "clean:" + msg[:100]


BOUNDARY = re.compile(r"^    [^\s})\]]")


def split(lines):
    """head (up to and including the init line), chunks of the init body, tail."""
    start = next(i for i, ln in enumerate(lines) if re.match(r"^  async init\(ctx\) \{", ln))
    end = max(i for i, ln in enumerate(lines) if ln.startswith("  }"))
    head, body, tail = lines[:start + 1], lines[start + 1:end], lines[end:]
    chunks, cur = [], []
    for ln in body:
        if BOUNDARY.match(ln) and cur:
            chunks.append(cur)
            cur = []
        cur.append(ln)
    if cur:
        chunks.append(cur)
    return head, chunks, tail


def main():
    d = os.path.abspath(sys.argv[1])
    manifest = json.load(open(os.path.join(d, "plethora.json")))
    text = open(os.path.join(d, manifest.get("entry", "main.js")), encoding="utf-8").read()
    text = text.replace("window.plethoraBit", "window.plethoraBitProbe")
    head, chunks, tail = split(text.split("\n"))
    print("%d top-level statements in init" % len(chunks))
    calls = [0]

    def build(keep):
        out = list(head)
        for k in keep:
            out.extend(chunks[k])
        out.extend(tail)
        return "\n".join(out)

    def test(keep):
        calls[0] += 1
        res = probe(manifest, build(keep))
        if res.startswith("CREATED"):
            sys.exit("a probe created a draft (%s); the rename did not take - stop and clean up" % res)
        time.sleep(0.3)
        return res

    full = test(list(range(len(chunks))))
    print("full source: %s" % full)
    if full != "scan":
        print("the scan passes on the full source; the rejection is elsewhere")
        return

    # ddmin over the statement indices
    keep = list(range(len(chunks)))
    n = 2
    while len(keep) >= 2:
        size = max(1, len(keep) // n)
        subsets = [keep[i:i + size] for i in range(0, len(keep), size)]
        reduced = False
        for sub in subsets:
            comp = [k for k in keep if k not in sub]
            if not comp:
                continue
            res = test(comp)
            print("  drop %d of %d statements -> %s" % (len(sub), len(keep), res))
            if res == "scan":
                keep = comp
                n = max(2, n - 1)
                reduced = True
                break
        if not reduced:
            if n >= len(keep):
                break
            n = min(len(keep), n * 2)

    print("\n%d probes. The rejection needs these %d statement(s):" % (calls[0], len(keep)))
    for k in keep:
        first = next((ln for ln in chunks[k] if ln.strip()), "")
        print("\n--- statement %d (%d lines), starts: %s" % (k, len(chunks[k]), first.strip()[:100]))
        for ln in chunks[k][:40]:
            print("      " + ln)
        if len(chunks[k]) > 40:
            print("      ... (%d more lines)" % (len(chunks[k]) - 40))


if __name__ == "__main__":
    main()
