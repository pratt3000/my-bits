#!/usr/bin/env python3
"""
Pair with Plethora and upload bits as drafts.

    python3 upload.py pair                    # once, then the token is durable
    python3 upload.py <bit-dir> [<bit-dir>…]  # upload/update drafts

Pairing is a one-time bootstrap: mint a code, the creator approves it on their
own device, and the access token that comes back is reusable until revoked. The
token is a credential — it is written to ~/.plethora/agent-token.json with mode
600 and must never be committed. Never ask the creator for a username, email,
password or any login; approval happens entirely on their device.

Two things about the pairing window that cost real time if you learn them the
hard way: the code expires ten minutes after minting, so only mint one when the
creator says they are at their phone; and the exchange endpoint rate-limits
below about 15 seconds, so poll no faster than that.

The response's "action" says whether the post created a new draft or updated an
existing one. Do not assume re-uploading the same title updates in place — it
has been observed creating a second draft instead, which leaves the creator with
duplicates to clean up by hand. Every upload is recorded in
~/.plethora/uploads.json, and a bit uploaded before that comes back "created"
prints a warning naming both ids, so the duplicate is noticed immediately rather
than found later in the Create tab.

Publishing always stays manual on the creator's side.
"""
import json
import os
import subprocess
import sys
import time

API = "https://api.plethora.studio/v1/agent"
TOKEN_DIR = os.path.expanduser("~/.plethora")
TOKEN_PATH = os.path.join(TOKEN_DIR, "agent-token.json")


def post(path, body, token=None):
    headers = ["-H", "Content-Type: application/json"]
    if token:
        headers += ["-H", "Authorization: Plethora-Agent " + token]
    r = subprocess.run(["curl", "-sS", "-X", "POST", API + path, *headers,
                        "--data-binary", "@-"],
                       input=json.dumps(body), capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"ok": False, "error": {"message": "unparseable: " + r.stdout[:300]}}


def load_token():
    if os.environ.get("PLETHORA_AGENT_TOKEN"):
        return os.environ["PLETHORA_AGENT_TOKEN"]
    if os.path.exists(TOKEN_PATH):
        return json.load(open(TOKEN_PATH))["accessToken"]
    return None


def pair():
    r = post("/pair/sessions", {"agentName": "Claude Code", "scopes": ["bits:draft:write"]})
    if not r.get("ok"):
        sys.exit("could not start pairing: " + json.dumps(r)[:300])
    d = r["data"]
    print("\n  Pairing code:  %s" % d["pairingCode"])
    print("  Link:          %s" % d["pairingUrl"])
    print("  Expires:       %s  (ten minutes)\n" % d["expiresAt"])
    print("Approve it in Plethora -> Create -> Connect agent. Polling every 15s...")

    sid, secret = d["sessionId"], d["sessionSecret"]
    for _ in range(40):
        time.sleep(15)
        e = post("/pair/sessions/%s/exchange" % sid, {"sessionSecret": secret})
        status = (e.get("data") or {}).get("status")
        if status == "approved":
            os.makedirs(TOKEN_DIR, exist_ok=True)
            # The token is returned exactly once, so write it before anything else.
            with open(TOKEN_PATH, "w") as f:
                json.dump(e["data"], f)
            os.chmod(TOKEN_PATH, 0o600)
            print("approved — token saved to %s (mode 600, never commit it)" % TOKEN_PATH)
            return
        if status in ("expired", "denied") or (not e.get("ok") and "rate" not in json.dumps(e)):
            sys.exit("pairing %s" % (status or json.dumps(e)[:200]))
    sys.exit("timed out waiting for approval")


LEDGER = os.path.join(TOKEN_DIR, "uploads.json")


def ledger():
    return json.load(open(LEDGER)) if os.path.exists(LEDGER) else {}


def remember(title, bit_id):
    os.makedirs(TOKEN_DIR, exist_ok=True)
    seen = ledger()
    ids = seen.setdefault(title, [])
    if bit_id and bit_id not in ids:
        ids.append(bit_id)
    json.dump(seen, open(LEDGER, "w"), indent=1)


def upload(dirs):
    token = load_token()
    if not token:
        sys.exit("no token — run `python3 upload.py pair` first")
    failures = 0
    for d in dirs:
        d = os.path.abspath(d)
        m = json.load(open(os.path.join(d, "plethora.json")))
        source = open(os.path.join(d, m.get("entry", "main.js")), encoding="utf-8").read()
        known = ledger().get(m["title"], [])
        r = post("/bits/drafts", {
            "title": m["title"], "description": m.get("description", ""),
            "tags": m.get("tags", []), "source": source, "manifest": m, "generated": True,
        }, token)
        name = os.path.basename(d)
        if r.get("ok"):
            data = r["data"]
            bit_id = (data.get("bit") or {}).get("id", "?")
            action = data.get("action", "ok")
            print("%-16s %s  id=%s  %d bytes" % (name, action, bit_id, data.get("packageBytes", 0)))
            if action == "created" and known and bit_id not in known:
                print("                 ! DUPLICATE: %r already existed as %s." % (m["title"], ", ".join(known)))
                print("                   The creator now has more than one draft with this title and")
                print("                   has to delete the spare in the app — say so rather than leaving")
                print("                   them to find it. There is no agent endpoint to delete a draft.")
            remember(m["title"], bit_id)
        else:
            failures += 1
            print("%-16s FAILED  %s" % (name, (r.get("error") or {}).get("message", json.dumps(r))[:200]))
            print("                 -> run check.py on it; see references/gotchas.md for how to bisect")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "pair":
        pair()
    else:
        upload(sys.argv[1:])
