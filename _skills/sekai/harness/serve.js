const http = require("http");
const fs = require("fs");
const path = require("path");
const HARNESS = __dirname;
// The bit under test can live anywhere; BIT_ROOT is set by run.js.
const REPO = process.env.BIT_ROOT || path.resolve(__dirname, "..", "..", "..");
const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file;
  if (url.startsWith("/repo/")) file = path.join(REPO, url.slice(6));
  else if (url.startsWith("/harness/")) file = path.join(HARNESS, url.slice(9));
  else if (url.startsWith("/vendor/")) file = path.join(HARNESS, "vendor", url.slice(8));
  else file = path.join(HARNESS, url === "/" ? "host.html" : url);
  if (!file.startsWith(HARNESS) && !file.startsWith(REPO)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found: " + file); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(Number(process.env.BIT_PORT) || 8791, () => console.log("serving on 8791"));
