#!/usr/bin/env python3
"""
Upload a bit as a draft with an MCP upload key (the plag_... key that the
Plethora MCP server's wait_for_pairing returns), over HTTPS:
    python3 upload_mcp.py <path/to/bit-dir>
The key is read from $PLAG or ~/.plethora/mcp-upload-key.json ({"uploadKey": ...}).
It lasts four hours. The same package sent again the same day (UTC) returns the
first upload's result, so a re-send to read back the id is safe. A changed
package needs a fresh Idempotency-Key (one is minted per call here).
Never commit the key or this directory's ledger.
"""
import json, os, subprocess, sys, uuid

API = "https://agent.plethora.studio/v1/agent/bits/drafts"
KEY_PATH = os.path.expanduser("~/.plethora/mcp-upload-key.json")
LEDGER = os.path.expanduser("~/.plethora/uploads.json")
CONTEXT = "plethora-agent-context-2026-10-22.1"


def key():
    if os.environ.get("PLAG"):
        return os.environ["PLAG"]
    return json.load(open(KEY_PATH))["uploadKey"]


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    bit = os.path.abspath(sys.argv[1])
    m = json.load(open(os.path.join(bit, "plethora.json")))
    src = open(os.path.join(bit, m.get("entry", "main.js")), encoding="utf-8").read()
    body = {"title": m["title"], "description": m.get("description", ""), "tags": m.get("tags", []),
            "source": src, "manifest": m, "generated": True,
            "agentFeedback": {"contextVersion": CONTEXT, "sdkVersion": "1.8.0", "outcome": "clear", "confidence": "high",
                              "unclear": [], "blockers": [], "repeatedFixes": [], "workarounds": [], "suggestions": [],
                              "docsMissing": [], "runtimeIssues": [], "validatorIssues": [], "libraryIssues": [],
                              "uploadIssues": [], "pairingIssues": []}}
    tmp = os.path.expanduser("~/.plethora/last-upload.json")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    open(tmp, "w").write(json.dumps(body))
    r = subprocess.run(["curl", "-sS", "--max-time", "180", "-X", "POST", API,
                        "-H", "Content-Type: application/json", "-H", "Authorization: Bearer " + key(),
                        "-H", "X-Plethora-Command-Protocol: v1", "-H", "Idempotency-Key: " + str(uuid.uuid4()),
                        "--data-binary", "@" + tmp], capture_output=True, text=True)
    try:
        res = json.loads(r.stdout)
    except Exception:
        sys.exit("unparseable response: " + r.stdout[:400] + r.stderr[:200])
    if not res.get("ok"):
        err = res.get("error") or res
        sys.exit("%-16s FAILED  %s" % (os.path.basename(bit), json.dumps(err)[:600]))
    d = res["data"]
    bit_id = (d.get("bit") or {}).get("id", "?")
    print("%-16s %s  id=%s  %d bytes" % (os.path.basename(bit), d.get("action"), bit_id, d.get("packageBytes", 0)))
    for n in d.get("notices") or []:
        print("                 notice %s: %s" % (n.get("code"), n.get("message")))
    seen = json.load(open(LEDGER)) if os.path.exists(LEDGER) else {}
    ids = seen.setdefault(m["title"], [])
    if bit_id != "?" and bit_id not in ids:
        ids.append(bit_id)
    json.dump(seen, open(LEDGER, "w"), indent=1)


if __name__ == "__main__":
    main()
