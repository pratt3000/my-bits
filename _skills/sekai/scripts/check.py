#!/usr/bin/env python3
"""
Check a bit against the manifest schema and the upload validator's habits.

    python3 check.py <path/to/bit-dir>

Runs before every upload. Two kinds of check:

- Manifest correctness, including the one the validator actually enforces and
  people actually get wrong: declared permissions have to match what the source
  really uses, in both directions. Declaring a permission you never exercise is
  rejected just as surely as using one you did not declare.

- Constructs that have been rejected by the upload validator before, or that
  the runtime does not provide. The validator reports almost everything as one
  unhelpful complaint about "unsupported remote resources", so it pays to catch
  these locally rather than bisect a rejection.

Exit status is non-zero if anything failed, so it can gate an upload.
"""
import json
import os
import re
import sys

PERMISSIONS = {"audio", "backgroundMusic", "camera", "haptics", "microphone", "motion", "storage"}

# What in the source implies each permission.
IMPLIES = {
    "audio": r"AudioContext|ctx\.audio\.",
    "backgroundMusic": r"ctx\.music",
    "camera": r"ctx\.camera\.",
    "microphone": r"ctx\.microphone\.",
    "motion": r"ctx\.sensors\.|ctx\.motion\.",
    "haptics": r"platform\.haptic\(",
    "storage": r"ctx\.storage\.",
}

# (pattern, label, why) — each has actually bitten somebody.
FORBIDDEN = [
    (r"document\.body", "document.body",
     "the bit does not own the page; use ctx.createRoot()"),
    (r"document\.createElement\(['\"]canvas", "raw canvas creation",
     "rejected by the validator; use ctx.createCanvas2D() or ctx.createCanvas()"),
    (r"getBoundingClientRect", "getBoundingClientRect",
     "rejected by the validator, even when only named in a comment; use e.offsetX/offsetY"),
    (r"(?<!ctx\.)\bsetTimeout\(", "bare setTimeout",
     "use ctx.timeout() so it is cancelled on teardown"),
    (r"(?<!ctx\.)\bsetInterval\(", "bare setInterval",
     "use ctx.interval() so it is cancelled on teardown"),
    (r"requestAnimationFrame", "requestAnimationFrame",
     "the runtime owns the frame loop; use ctx.onFrame()"),
    (r"DOMContentLoaded", "DOMContentLoaded",
     "init(ctx) is the entry point; the document has long since loaded"),
    (r"\bfetch\(|XMLHttpRequest|new Worker|importScripts", "network or worker",
     "no network egress; generate everything in-file"),
    (r"<script|\.src\s*=", "script tag or element .src",
     "no remote resources; inline it"),
    (r"postMessage", "postMessage",
     "host platform scaffolding; delete it"),
    (r"storage\.(set|remove|clear)\([^)]*\)\s*\.(then|catch)", "chaining onto ctx.storage.set",
     "it returns nothing on device and .catch() on undefined kills the bit"),
]


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    d = os.path.abspath(sys.argv[1])
    man_path = os.path.join(d, "plethora.json")
    if not os.path.exists(man_path):
        sys.exit("no plethora.json in " + d)
    m = json.load(open(man_path))
    entry = m.get("entry", "main.js")
    src_path = os.path.join(d, entry)
    if not os.path.exists(src_path):
        sys.exit("manifest entry %r does not exist in %s" % (entry, d))
    src = open(src_path, encoding="utf-8").read()

    ok, bad = [], []

    def chk(cond, msg):
        (ok if cond else bad).append(msg)

    chk(m.get("schemaVersion") == 1, "schemaVersion is 1")
    chk(m.get("runtime") == "plethora-bit@2", "runtime is plethora-bit@2")
    chk(bool(m.get("title")), "title present")
    chk(bool(m.get("description")), "description present")
    chk(isinstance(m.get("tags"), list) and m["tags"], "tags present")
    for t in m.get("tags", []):
        chk(bool(re.match(r"^[a-z0-9-]{1,32}$", t)), "tag %r matches ^[a-z0-9-]{1,32}$" % t)
    chk(set(m.get("permissions", [])) <= PERMISSIONS,
        "permissions are all recognised")
    chk("window.plethoraBit" in src, "source defines window.plethoraBit")
    chk("async init" in src or "init(ctx)" in src, "source defines init(ctx)")

    declared = set(m.get("permissions", []))
    for perm, pattern in IMPLIES.items():
        used = bool(re.search(pattern, src))
        if used:
            chk(perm in declared, "uses %s and declares it" % perm)
        if perm in declared:
            chk(used, "declares %s and actually uses it" % perm)

    for pattern, label, why in FORBIDDEN:
        chk(not re.search(pattern, src), "no %s (%s)" % (label, why))

    size = len(src.encode())
    chk(size < 2 * 1024 * 1024, "source is %d bytes, under the 2 MB package limit" % size)

    print("PASS (%d)" % len(ok))
    for o in ok:
        print("  +", o)
    if bad:
        print("\nFAIL (%d)" % len(bad))
        for b in bad:
            print("  -", b)
        print("\nFix these before uploading — the validator's error message will not tell you which one.")
        sys.exit(1)
    print("\nReady to upload.")


if __name__ == "__main__":
    main()
