/**
 * Sketch Racer — draw the longest track you dare, then drive it.
 *
 * Two moves. Drag a line anywhere on the paper and it becomes a road, metering
 * its own length as you go. Then hit RACE and a little car sets off along it,
 * nose following the curve, camera locked to the bonnet, engine note rising
 * with speed, until it crosses the chequered flag you left at the end.
 *
 * The score is simply how long a road you drew. There is no skill in driving
 * it — the car always finishes — so the whole game is in the drawing: how much
 * track can you cram into one gesture before you run out of patience or screen.
 * Finish inside the global top five and the car turns to diamond, which is
 * cosmetic and entirely the point.
 *
 * Ported from a standalone Sekai build. The drawing, the path maths, the car
 * and the race are the original's, unchanged. The shell was rebuilt for
 * plethora-bit@2, and the leaderboard was translated rather than invented: the
 * original already kept one through Sekai's own save/top-results API, so this
 * is the same board with ctx.memory.record behind it instead.
 *
 * Icon geometry is lucide (ISC licence), inlined as SVG.
 */
window.plethoraBit = {
  meta: {
    title: "Sketch Racer",
    runtime: "plethora-bit@2",
    tags: ["game", "drawing", "racing", "casual", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Look — the palette the original shipped                            //
    // ===================================================================== //
    const PAPER = "#f8f5e6";
    const TRACK = "#2d3436";
    const CAR = "#ff6b6b";
    const INK = "#2d3436";
    const DIM = "#6b7280";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    // Tune values as shipped, not the source fallbacks.
    const BASE_SPEED = 35;     // px per frame at 60 fps
    const LINE_WIDTH = 40;
    const CAR_SCALE = 1;
    const MIN_LENGTH = 20;     // shorter than this and the scribble is discarded

    const ICONS = {
      "flag": '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
      "trash-2": '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      "trophy": '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
      "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      "gem": '<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/>'
    };
    function svg(name, size, colour) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
        'stroke="' + colour + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;pointer-events:none;">' + (ICONS[name] || "") + "</svg>";
    }

    const state = {
      mode: "draw",            // draw | racing | finished
      path: [],
      totalLength: 0,
      progress: 0,
      speed: 0,
      drawing: false,
      camera: { x: 0, y: 0 },
      diamondUnlocked: false,
      diamondEquipped: false,
      best: 0
    };

    // ===================================================================== //
    // 1. Surfaces                                                           //
    // ===================================================================== //
    const view = ctx.createCanvas2D({ touchAction: "none" });
    const g = view.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "3";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      const bw = Math.round(W * ctx.dpr), bh = Math.round(H * ctx.dpr);
      if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      top.style.top = SAFE_T + "px";
      bottom.style.bottom = SAFE_B + "px";
    }

    const btn = (el, bg, fg, label, icon) =>
      '<button data-el="' + el + '" style="pointer-events:auto;display:flex;align-items:center;' +
      'justify-content:center;gap:7px;height:52px;padding:0 22px;border-radius:26px;border:0;' +
      "background:" + bg + ";color:" + fg + ';font-size:15px;font-weight:800;font-family:inherit;' +
      'letter-spacing:0.6px;box-shadow:0 5px 16px rgba(0,0,0,0.2);">' +
      (icon ? svg(icon, 18, fg) : "") + "<span>" + label + "</span></button>";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      // distance readout
      '<div data-el="top" style="position:absolute;left:0;right:0;display:flex;flex-direction:column;' +
      'align-items:center;pointer-events:none;">' +
        '<div style="font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        "Track length</div>" +
        '<div data-el="dist" style="font-size:38px;font-weight:800;letter-spacing:-1px;line-height:1.1;">0.0m</div>' +
        '<div data-el="best" style="font-size:11.5px;color:' + DIM + ';margin-top:1px;"></div>' +
      "</div>" +

      // draw prompt / controls
      '<div data-el="bottom" style="position:absolute;left:0;right:0;display:flex;flex-direction:column;' +
      'align-items:center;gap:11px;padding:0 18px;">' +
        '<div data-el="hint" style="font-size:14px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">draw a road with one finger</div>' +
        '<div data-el="controls" style="display:none;gap:10px;">' +
          btn("race", TRACK, "#ffffff", "RACE", "flag") +
          btn("clear", "rgba(45,52,54,0.1)", TRACK, "CLEAR", "trash-2") +
        "</div>" +
      "</div>" +

      // result / leaderboard sheet
      '<div data-el="sheet" style="position:absolute;inset:0;display:none;background:rgba(20,22,24,0.93);' +
      '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);z-index:9;pointer-events:auto;' +
      'padding:26px 20px;overflow-y:auto;touch-action:pan-y;color:#f3f4f6;">' +
        '<div style="max-width:330px;margin:0 auto;">' +
          '<div style="display:flex;gap:8px;margin-bottom:18px;">' +
            '<button data-el="tab_result" style="flex:1;height:40px;border-radius:20px;border:0;' +
            'font-family:inherit;font-size:13px;font-weight:700;pointer-events:auto;">Result</button>' +
            '<button data-el="tab_board" style="flex:1;height:40px;border-radius:20px;border:0;' +
            'font-family:inherit;font-size:13px;font-weight:700;pointer-events:auto;">Leaderboard</button>' +
          "</div>" +

          '<div data-el="view_result" style="text-align:center;">' +
            '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">' +
            "You drew</div>" +
            '<div data-el="final" style="font-size:52px;font-weight:800;letter-spacing:-2px;' +
            'margin:5px 0 3px;">0.0m</div>' +
            '<div data-el="verdict" style="font-size:13px;color:#9ca3af;margin-bottom:20px;"></div>' +
            '<div data-el="diamond_area" style="display:none;background:rgba(6,182,212,0.12);' +
            'border:1px solid rgba(6,182,212,0.4);border-radius:14px;padding:14px;margin-bottom:18px;">' +
              '<div style="display:flex;align-items:center;justify-content:center;gap:7px;' +
              'font-size:13.5px;font-weight:700;color:#67e8f9;">' + svg("gem", 16, "#67e8f9") +
              "<span>Diamond car unlocked</span></div>" +
              '<div data-el="diamond_msg" style="font-size:11.5px;color:#a5f3fc;margin-top:6px;' +
              'display:none;">Top five. It is yours.</div>' +
              '<button data-el="diamond_btn" style="margin-top:11px;height:36px;padding:0 20px;' +
              'border-radius:18px;border:0;font-family:inherit;font-size:12.5px;font-weight:700;' +
              'pointer-events:auto;background:#ffffff;color:#0891b2;">Equip</button>' +
            "</div>" +
            '<button data-el="retry" style="pointer-events:auto;width:100%;height:52px;border-radius:26px;' +
            'border:0;background:#f3f4f6;color:#111827;font-size:15px;font-weight:800;font-family:inherit;' +
            'letter-spacing:0.6px;">DRAW ANOTHER</button>' +
          "</div>" +

          '<div data-el="view_board" style="display:none;">' +
            '<div data-el="board" style="font-size:13px;"></div>' +
            '<button data-el="back" style="pointer-events:auto;width:100%;height:48px;border-radius:24px;' +
            'border:0;background:#f3f4f6;color:#111827;font-size:14px;font-weight:700;font-family:inherit;' +
            'margin-top:16px;">BACK</button>' +
          "</div>" +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const top = nodes.top, bottom = nodes.bottom;

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    // The original generated `boost` and `win` into buffers itself and only
    // reached for a file if one happened to be attached. Those generators are
    // kept exactly; the attached files are gone, so the fallback is now the
    // whole story. The engine is a sawtooth whose pitch tracks speed.
    const AudioSys = {
      ac: null,
      buffers: {},
      engineOsc: null,
      engineGain: null,

      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.build();
      },

      build() {
        const make = (fn, duration) => {
          const rate = this.ac.sampleRate;
          const buf = this.ac.createBuffer(1, Math.floor(rate * duration), rate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = fn(i / rate, i);
          return buf;
        };
        this.buffers.boost = make((t) => (Math.random() * 2 - 1) * Math.max(0, 1 - t * 2) * 0.5, 0.5);
        this.buffers.win = make((t) => {
          const env = Math.max(0, 1 - t);
          const f = t < 0.1 ? 440 : t < 0.2 ? 554 : 659;
          return Math.sin(t * f * Math.PI * 2) * env * 0.5;
        }, 1.0);
      },

      play(id) {
        if (!this.ac || !this.buffers[id]) return;
        if (this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }
        const src = this.ac.createBufferSource();
        src.buffer = this.buffers[id];
        src.connect(this.ac.destination);
        try { src.start(); } catch (_) {}
      },

      startEngine() {
        if (!this.ac || this.engineOsc) return;
        this.engineOsc = this.ac.createOscillator();
        this.engineGain = this.ac.createGain();
        this.engineOsc.type = "sawtooth";
        this.engineOsc.frequency.value = 60;
        this.engineGain.gain.value = 0.05;
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(this.ac.destination);
        try { this.engineOsc.start(); } catch (_) {}
      },

      updateEngine(ratio) {
        if (this.engineOsc) {
          this.engineOsc.frequency.setTargetAtTime(60 + ratio * 100, this.ac.currentTime, 0.1);
        }
      },

      stopEngine() {
        if (!this.engineOsc) return;
        try { this.engineOsc.stop(); } catch (_) {}
        this.engineOsc = null;
      },

      close() {
        this.stopEngine();
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null;
      }
    };

    let music = null;

    // ===================================================================== //
    // 3. The road                                                           //
    // ===================================================================== //
    function pathLength(path) {
      let len = 0;
      for (let i = 0; i < path.length - 1; i++) {
        len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
      }
      return len;
    }

    // Thin the raw pointer samples: anything closer than 5px adds nothing but
    // work, and the road reads the same.
    function smoothPath(path) {
      if (path.length < 3) return path;
      const out = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const last = out[out.length - 1];
        if (Math.hypot(path[i].x - last.x, path[i].y - last.y) > 5) out.push(path[i]);
      }
      return out;
    }

    function pointOnPath(dist) {
      if (state.path.length < 2) return { x: 0, y: 0, angle: 0 };
      let acc = 0;
      for (let i = 0; i < state.path.length - 1; i++) {
        const p1 = state.path[i], p2 = state.path[i + 1];
        const seg = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (acc + seg >= dist) {
          const t = seg === 0 ? 0 : (dist - acc) / seg;
          return {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t,
            angle: Math.atan2(p2.y - p1.y, p2.x - p1.x)
          };
        }
        acc += seg;
      }
      const last = state.path[state.path.length - 1];
      const prev = state.path[state.path.length - 2];
      return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
    }

    const metres = (px) => px / 10;
    const fmt = (m) => m.toFixed(1) + "m";

    // ===================================================================== //
    // 4. Drawing it                                                         //
    // ===================================================================== //
    function drawCar(x, y, angle, scale) {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.scale(scale, scale);

      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(-12, -8, 28, 20);

      const diamond = state.diamondEquipped;
      if (diamond) {
        const grad = g.createLinearGradient(-15, -10, 15, 10);
        grad.addColorStop(0, "#b2fefa");
        grad.addColorStop(0.5, "#ffffff");
        grad.addColorStop(1, "#0ed2f7");
        g.fillStyle = grad;
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
      } else {
        g.fillStyle = CAR;
      }

      g.beginPath();
      roundRect(-15, -10, 30, 20, 5);
      g.fill();
      if (diamond) g.stroke();

      if (diamond) {
        const t = Date.now() * 0.005;
        g.fillStyle = "#fff";
        for (let i = 0; i < 3; i++) {
          g.globalAlpha = (Math.sin(t * 2 + i) + 1) * 0.5;
          g.fillRect(Math.sin(t + i) * 10, Math.cos(t * 0.7 + i) * 6, 2, 2);
        }
        g.globalAlpha = 1;
      }

      g.fillStyle = diamond ? "#e0f7fa" : "#fff";
      g.beginPath();
      roundRect(-5, -8, 15, 16, 3);
      g.fill();
      g.fillStyle = "#333";
      g.fillRect(5, -6, 4, 12);
      g.fillStyle = "#ffeaa7";
      g.beginPath();
      g.arc(14, -6, 2, 0, Math.PI * 2);
      g.arc(14, 6, 2, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // roundRect is not everywhere yet; this keeps the car's shape identical.
    function roundRect(x, y, w, h, r) {
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function render() {
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);

      g.save();
      if (state.mode !== "draw") g.translate(state.camera.x, state.camera.y);

      if (state.path.length > 1) {
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = TRACK;
        g.lineWidth = LINE_WIDTH;
        g.beginPath();
        g.moveTo(state.path[0].x, state.path[0].y);
        for (let i = 1; i < state.path.length; i++) g.lineTo(state.path[i].x, state.path[i].y);
        g.stroke();

        // chequered flag at the far end
        const last = state.path[state.path.length - 1];
        const prev = state.path[state.path.length - 2] || state.path[0];
        const a = (last.x === prev.x && last.y === prev.y) ? 0 : Math.atan2(last.y - prev.y, last.x - prev.x);
        g.save();
        g.translate(last.x, last.y);
        g.rotate(a);
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 8; j++) {
            g.fillStyle = (i + j) % 2 === 0 ? "#000" : "#fff";
            g.fillRect(-10 + i * 6, -20 + j * 5, 6, 5);
          }
        }
        g.restore();
      }

      if (state.path.length > 0) {
        const pos = pointOnPath(state.mode === "draw" ? 0 : state.progress);
        drawCar(pos.x, pos.y, pos.angle, CAR_SCALE);
      }
      g.restore();
    }

    // ===================================================================== //
    // 5. Racing it                                                          //
    // ===================================================================== //
    function resetGame() {
      state.path = [];
      state.totalLength = 0;
      state.mode = "draw";
      state.drawing = false;
      state.progress = 0;
      state.speed = 0;
      state.camera = { x: 0, y: 0 };
      nodes.dist.textContent = "0.0m";
      nodes.hint.style.display = "block";
      nodes.hint.style.opacity = "1";
      nodes.controls.style.display = "none";
      nodes.sheet.style.display = "none";
      AudioSys.stopEngine();
    }

    function startRace() {
      if (state.path.length < 2) return;
      state.mode = "racing";
      state.progress = 0;
      state.speed = 0;
      nodes.controls.style.display = "none";
      nodes.hint.style.display = "none";
      AudioSys.startEngine();
      ctx.platform.interact({ kind: "race", metres: +metres(state.totalLength).toFixed(1) });
    }

    async function finishRace() {
      state.mode = "finished";
      AudioSys.stopEngine();
      AudioSys.play("win");
      ctx.platform.haptic("success");

      const m = metres(state.totalLength);
      nodes.final.textContent = fmt(m);
      nodes.dist.textContent = fmt(m);

      if (m > state.best) {
        state.best = m;
        nodes.verdict.textContent = "A personal best.";
        remember();
      } else {
        nodes.verdict.textContent = "Your best is " + fmt(state.best) + ".";
      }
      showBest();

      nodes.sheet.style.display = "block";
      showTab("result");
      ctx.platform.complete({ metres: +m.toFixed(1) });

      // Submit, then ask the board whether that landed in the top five.
      if (records) {
        try {
          await records.submit(+m.toFixed(1), { label: fmt(m) });
          const board = await records.leaderboard();
          const entries = (board && board.entries) || [];
          const top5 = entries.slice(0, 5);
          const inTop5 = top5.length < 5 || top5.some((e) => e.self) ||
            (+m.toFixed(1)) >= (top5[top5.length - 1].value || 0);
          if (inTop5 && !state.diamondUnlocked) {
            state.diamondUnlocked = true;
            paintDiamond(true);
            remember();
            ctx.platform.milestone("diamond_unlocked");
          } else {
            paintDiamond(false);
          }
        } catch (_) { paintDiamond(false); }
      } else {
        paintDiamond(false);
      }
    }

    function advance(dt) {
      // The original stepped per frame; normalising to 60 fps keeps a 120 Hz
      // phone from racing at double speed.
      const k = Math.min(3, dt / (1000 / 60));
      state.speed += (BASE_SPEED - state.speed) * 0.1 * k;
      state.progress += state.speed * k;

      const target = pointOnPath(state.progress);
      const tx = W / 2 - target.x;
      const ty = H / 2 - target.y;
      state.camera.x += (tx - state.camera.x) * 0.1 * k;
      state.camera.y += (ty - state.camera.y) * 0.1 * k;

      AudioSys.updateEngine(state.speed / BASE_SPEED);
      nodes.dist.textContent = fmt(metres(Math.min(state.progress, state.totalLength)));

      if (state.progress >= state.totalLength) finishRace();
    }

    // ===================================================================== //
    // 6. The board                                                          //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("distance") : null;

    function showTab(which) {
      const onResult = which === "result";
      nodes.view_result.style.display = onResult ? "block" : "none";
      nodes.view_board.style.display = onResult ? "none" : "block";
      nodes.tab_result.style.background = onResult ? "#f3f4f6" : "rgba(255,255,255,0.1)";
      nodes.tab_result.style.color = onResult ? "#111827" : "#d1d5db";
      nodes.tab_board.style.background = onResult ? "rgba(255,255,255,0.1)" : "#f3f4f6";
      nodes.tab_board.style.color = onResult ? "#d1d5db" : "#111827";
      if (!onResult) loadBoard();
    }

    async function loadBoard() {
      nodes.board.innerHTML = '<div style="color:#9ca3af;padding:18px 0;text-align:center;">Loading…</div>';
      if (!records) {
        nodes.board.innerHTML = '<div style="color:#9ca3af;padding:18px 0;text-align:center;">' +
          "No leaderboard here.</div>";
        return;
      }
      try {
        const data = await records.leaderboard();
        const entries = (data && data.entries) || [];
        if (!entries.length) {
          nodes.board.innerHTML = '<div style="color:#9ca3af;padding:18px 0;text-align:center;">' +
            "Nobody has drawn a road yet.<br>Yours goes up first.</div>";
          return;
        }
        let html = "";
        for (const e of entries) {
          const rank = e.rank || 0;
          const medal = rank === 1 ? "#fbbf24" : rank === 2 ? "#d1d5db" : rank === 3 ? "#d97706" : "rgba(255,255,255,0.12)";
          const fg = rank <= 3 ? "#111827" : "#d1d5db";
          html +=
            '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.07);">' +
              '<div style="width:26px;height:26px;border-radius:13px;background:' + medal + ";color:" + fg + ";" +
              'display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;' +
              'flex-shrink:0;">' + rank + "</div>" +
              '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
              (e.self ? "font-weight:700;color:#67e8f9;" : "color:#e5e7eb;") + '">' +
              ((e.user && e.user.handle) || "Ghost Racer") + (e.self ? " (you)" : "") + "</div>" +
              '<div style="font-weight:800;font-size:14px;">' + (e.label || (e.value + "m")) + "</div>" +
            "</div>";
        }
        nodes.board.innerHTML = html;
      } catch (_) {
        nodes.board.innerHTML = '<div style="color:#fca5a5;padding:18px 0;text-align:center;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    function paintDiamond(showMsg) {
      if (!state.diamondUnlocked) { nodes.diamond_area.style.display = "none"; return; }
      nodes.diamond_area.style.display = "block";
      nodes.diamond_msg.style.display = showMsg ? "block" : "none";
      nodes.diamond_btn.textContent = state.diamondEquipped ? "Unequip" : "Equip";
      nodes.diamond_btn.style.background = state.diamondEquipped ? "#06b6d4" : "#ffffff";
      nodes.diamond_btn.style.color = state.diamondEquipped ? "#ffffff" : "#0891b2";
    }

    function showBest() {
      nodes.best.textContent = state.best > 0 ? "best " + fmt(state.best) : "";
    }

    // ===================================================================== //
    // 7. Hands on it                                                        //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      AudioSys.init();
      ctx.platform.start();
      if (ctx.capabilities.backgroundMusic && ctx.music) {
        try {
          ctx.music.unlock();
          music = ctx.music.play({ preset: "lofi", volume: 0.34, intensity: 0.4 });
        } catch (_) { music = null; }
      }
    }

    ctx.listen(view, "pointerdown", (e) => {
      if (state.mode !== "draw") return;
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      state.drawing = true;
      state.path = [{ x: e.offsetX, y: e.offsetY }];
      nodes.hint.style.opacity = "0";
      nodes.controls.style.display = "none";
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!state.drawing || state.mode !== "draw") return;
      state.path.push({ x: e.offsetX, y: e.offsetY });
      nodes.dist.textContent = fmt(metres(pathLength(state.path)));
    });

    const endDraw = () => {
      if (!state.drawing || state.mode !== "draw") return;
      state.drawing = false;
      state.path = smoothPath(state.path);
      const len = pathLength(state.path);
      if (state.path.length >= 2 && len >= MIN_LENGTH) {
        state.totalLength = len;
        nodes.controls.style.display = "flex";
        ctx.platform.haptic("light");
      } else {
        state.path = [];
        nodes.hint.style.display = "block";
        nodes.hint.style.opacity = "1";
        nodes.dist.textContent = "0.0m";
      }
    };
    ctx.listen(view, "pointerup", endDraw);
    ctx.listen(view, "pointercancel", endDraw);
    ctx.listen(view, "lostpointercapture", endDraw);

    const tap = (el, fn) => ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); firstGesture(); fn(); });
    tap(nodes.race, () => { startRace(); ctx.platform.haptic("medium"); });
    tap(nodes.clear, () => { resetGame(); ctx.platform.haptic("light"); });
    tap(nodes.retry, () => { resetGame(); ctx.platform.haptic("light"); });
    tap(nodes.back, () => showTab("result"));
    tap(nodes.tab_result, () => showTab("result"));
    tap(nodes.tab_board, () => showTab("board"));
    tap(nodes.diamond_btn, () => {
      state.diamondEquipped = !state.diamondEquipped;
      paintDiamond(false);
      remember();
      ctx.platform.haptic("light");
    });

    // ===================================================================== //
    // 8. Remembering                                                        //
    // ===================================================================== //
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* not supported on this runtime */ }
    }
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    let saveTimer = 0;
    function remember() {
      if (!canStore || saveTimer) return;
      saveTimer = ctx.timeout(() => {
        saveTimer = 0;
        fireAndForget(() => ctx.storage.set("sketchracer", {
          best: state.best,
          diamondUnlocked: state.diamondUnlocked,
          diamondEquipped: state.diamondEquipped
        }));
      }, 400);
    }
    if (canStore) {
      try {
        const saved = await ctx.storage.get("sketchracer");
        if (saved && typeof saved === "object") {
          if (typeof saved.best === "number") state.best = saved.best;
          state.diamondUnlocked = !!saved.diamondUnlocked;
          state.diamondEquipped = !!saved.diamondEquipped;
        }
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 9. Go                                                                 //
    // ===================================================================== //
    ctx.onDestroy(() => {
      AudioSys.close();
      if (music) { try { music.stop({ fadeOutMs: 300 }); } catch (_) {} }
      try { ctx.music.stop({ fadeOutMs: 300 }); } catch (_) {}
    });

    layout();
    resetGame();
    showBest();
    paintDiamond(false);
    showTab("result");
    render();
    ctx.markVisualReady("paper drawn");
    ctx.platform.ready();

    ctx.onFrame((dt) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      if (state.mode === "racing") advance(dt);
      render();
    });
  }
};
