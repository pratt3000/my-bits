/*
 * Barrel Heights
 * A faithful-in-spirit recreation of the 1981 four-screen arcade climber:
 * girders, ladders, rolling barrels, the pie factory, the elevators and the
 * rivets. Runs at the arcade's 224x256 and scales up in whole pixels.
 *
 * All art, sound and code here is original and hand-made in this file; the
 * screens are laid out from memory of the genre rather than copied.
 *
 * Runtime: plethora-bit@2 (window.plethoraBit) · 2D canvas · synth audio
 */

window.plethoraBit = {
  meta: {
    title: "Barrel Heights",
    runtime: "plethora-bit@2",
    tags: ["arcade", "platformer", "retro", "pixel", "score", "mobile"],
    permissions: ["haptics", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    // ---- helpers -------------------------------------------------------------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const chance = (p) => Math.random() < p;
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) { try { const v = canStore ? ctx.storage.get("bh_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("bh_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // ---- arcade framebuffer ---------------------------------------------------
    const FW = 224, FH = 256;
    const fbc = new OffscreenCanvas(FW, FH);
    const fb = fbc.getContext("2d");
    fb.imageSmoothingEnabled = false;

    // ---- palette + sprites ----------------------------------------------------
    const PAL = {
      R: "#ee3a2c", S: "#f7b78f", B: "#2f52ff", H: "#7a3b12", K: "#101010", W: "#ffffff",
      D: "#a8571f", T: "#f2c48c", P: "#ff8fc8", p: "#ffd7ea", Y: "#f8d820", O: "#ff7a1c",
      C: "#1ce8ff", G: "#c8c8d0", g: "#70707a", b: "#1c2c9a", N: "#c07a2a", n: "#6e3a0e",
      A: "#4a78ff", a: "#1a2e9a", L: "#ffb4b4", r: "#f24a3c", E: "#ff4d8c", V: "#8cf0ff"
    };
    function raster(rows, flip) {
      const h = rows.length, w = rows[0].length;
      const oc = new OffscreenCanvas(w, h), c = oc.getContext("2d");
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ch = rows[y][x]; if (ch === "." || ch === " ") continue;
        c.fillStyle = PAL[ch] || "#ff00ff"; c.fillRect(flip ? w - 1 - x : x, y, 1, 1);
      }
      return oc;
    }
    const SPR = {};
    function def(name, rows) { SPR[name] = raster(rows, false); SPR[name + "_f"] = raster(rows, true); }

    // Jumpman-style carpenter, 12x16, drawn facing right
    def("stand", [
      "....RRRRR...", "...RRRRRRRRR", "...HHHSSKS..", "..HSHSSSSSS.", "..HSHHSSSSS.", "..HHSSSSSS..",
      "....SSSSS...", "..BBRRRRBB..", ".BBBRRRRBBB.", ".BBBRRRRBBB.", ".SSRRRRRRSS.", ".SSRRRRRRSS.",
      "..RRRRRRRR..", "..RRR..RRR..", ".HHH....HHH.", "HHHH....HHHH"]);
    def("walk", [
      "....RRRRR...", "...RRRRRRRRR", "...HHHSSKS..", "..HSHSSSSSS.", "..HSHHSSSSS.", "..HHSSSSSS..",
      "....SSSSS...", "..BBRRRRBB..", ".BBBRRRRBBB.", ".BBBRRRRBBBS", ".SSRRRRRRRS.", ".SSRRRRRRR..",
      "..RRRRRRRR..", ".RRRR..RRRR.", "HHHH....HHHH", "HHH......HHH"]);
    def("jump", [
      ".S..RRRRR...", ".S.RRRRRRRRR", "SS.HHHSSKS..", "BB.SHSSSSSS.", ".BBSHHSSSSS.", ".BBHHSSSSSS.",
      "..BB.SSSSS..", "..BBBRRRRBB.", "...BBRRRRBBS", "...BRRRRRRSS", "...RRRRRRRS.", "...RRRRRRR..",
      "..RRRR.RRRR.", ".HHHH..HHHH.", "HHHH...HHHH.", "............"]);
    def("climbA", [
      "....RRRRR...", "...RRRRRRR..", "...HHHHHHH..", "..HHHHHHHHH.", "..HHHHHHHHH.", "SS.HHHHHHH..",
      "SS..SSSSS...", ".BBBBBBBBBSS", "..BBBRRBBBSS", "..BBRRRRBB..", "...RRRRRR...", "...RRRRRR...",
      "...RRRRRR...", "...RRR.RR...", "...HHH.HHH..", "..HHHH.HHHH."]);
    def("climbTop", [   // hauling over the top rung: only the upper half shows
      "............", "............", "............", "............", "............", "............",
      "............", "............", "....RRRRR...", "...RRRRRRR..", "...HHHHHHH..", "SSHHHHHHHHHS",
      "SSHHHHHHHHHS", "...HHHHHHH..", "...BSSSSSB..", "..BBBBBBBBB."]);
    def("hammerUp", [   // arms raised holding the shaft overhead
      "....RRRRR...", "...RRRRRRRRR", "...HHHSSKS..", "..HSHSSSSSS.", "..HSHHSSSSS.", "..HHSSSSSS..",
      "SS..SSSSS.SS", "BBBBRRRRBBBB", ".BBBRRRRBBB.", "..BBRRRRBB..", "...RRRRRR...", "...RRRRRR...",
      "..RRRRRRRR..", "..RRR..RRR..", ".HHH....HHH.", "HHHH....HHHH"]);
    def("hammerDown", [
      "....RRRRR...", "...RRRRRRRRR", "...HHHSSKS..", "..HSHSSSSSS.", "..HSHHSSSSS.", "..HHSSSSSS..",
      "....SSSSS...", "..BBRRRRBB..", ".BBBRRRRBBBB", ".BBBRRRRBBSS", "..RRRRRRRR..", "..RRRRRRRR..",
      "..RRRRRRRR..", "..RRR..RRR..", ".HHH....HHH.", "HHHH....HHHH"]);
    def("hammer", [   // mallet, head at the top
      "YYYYYYYY", "YYYYYYYY", "YYOYYOYY", "YYYYYYYY", "...HH...", "...HH...", "...HH...", "...HH...", "...HH...", "...HH..."]);
    def("hammerSide", [   // mallet held out flat, head on the right
      "......YYYY", "HHHHHHYYYY", "HHHHHHYYOY", "......YYYY"]);

    // the ape, 40x32 body, arms drawn separately
    def("kong", [
      "..............DDDDDDDDDDDD..............",
      "............DDDDDDDDDDDDDDDD............",
      "...........DDDDDDDDDDDDDDDDDD...........",
      "..........DDDDDTTTTTTTTTTDDDDD..........",
      "..........DDDTTTTTTTTTTTTTTDDD..........",
      "..........DDTTTKKTTTTTTKKTTTDD..........",
      "..........DDTTTKKTTTTTTKKTTTDD..........",
      "..........DDTTTTTTTKKTTTTTTTDD..........",
      "..........DDTTTTTTKKKKTTTTTTDD..........",
      "..........DDDTTKKKKKKKKKKTTDDD..........",
      "..........DDDTTKWWKWWKWWKTTDDD..........",
      "...........DDDTTTTTTTTTTTTDDD...........",
      "............DDDDDDDDDDDDDDDD............",
      ".........DDDDDDDDDDDDDDDDDDDDDD.........",
      ".......DDDDDDDDDDDDDDDDDDDDDDDDDD.......",
      "......DDDDDDDDTTTTTTTTTTTTDDDDDDDD......",
      "......DDDDDDDTTTTTTTTTTTTTTDDDDDDD......",
      "......DDDDDDDTTTTTTTTTTTTTTDDDDDDD......",
      "......DDDDDDDTTTTTTTTTTTTTTDDDDDDD......",
      "......DDDDDDDTTTTTTTTTTTTTTDDDDDDD......",
      "......DDDDDDDDTTTTTTTTTTTTDDDDDDDD......",
      "......DDDDDDDDDTTTTTTTTTTDDDDDDDDD......",
      ".......DDDDDDDDDDDDDDDDDDDDDDDDDD.......",
      "........DDDDDDDDDDDDDDDDDDDDDDDD........",
      ".........DDDDDDDDDDDDDDDDDDDDDD.........",
      "........DDDDDDDDD......DDDDDDDDD........",
      ".......DDDDDDDDDD......DDDDDDDDDD.......",
      ".......DDDDDDDDD........DDDDDDDDD.......",
      ".......DDDDDDDDD........DDDDDDDDD.......",
      "......DDDDDDDDDD........DDDDDDDDDD......",
      "......TTTTTTTTTT........TTTTTTTTTT......",
      "......TTTTTTTTTT........TTTTTTTTTT......"]);
    def("armUp", ["..TTTT..", ".TTTTTT.", ".TTTTTT.", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", ".DDDDDD.", ".DDDDDD."]);
    def("armDown", [".DDDDDD.", ".DDDDDD.", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", "..DDDD..", ".TTTTTT.", ".TTTTTT.", "..TTTT.."]);
    def("armOut", ["DDDDDDDDDTTT", "DDDDDDDDTTTT", "DDDDDDDDTTTT", "..DDDDDDDTTT"]);
    def("kongSide", [   // climbing away with the lady: compact back view
      "..........DDDDDDDDDDDD..........",
      "........DDDDDDDDDDDDDDDD........",
      ".......DDDDDDDDDDDDDDDDDD.......",
      ".......DDDDDDDDDDDDDDDDDD.......",
      "......DDDDDDDDDDDDDDDDDDDD......",
      "....DDDDDDDDDDDDDDDDDDDDDDDD....",
      "..DDDDDDDDDDDDDDDDDDDDDDDDDDDD..",
      ".DDDDDDDDDDDDDDDDDDDDDDDDDDDDDD.",
      "TTTDDDDDDDDDDDDDDDDDDDDDDDDDDTTT",
      "TTTDDDDDDDDDDDDDDDDDDDDDDDDDDTTT",
      ".DDDDDDDDDDDDDDDDDDDDDDDDDDDDDD.",
      "..DDDDDDDDDDDDDDDDDDDDDDDDDDDD..",
      "...DDDDDDDDDDDDDDDDDDDDDDDDDD...",
      "....DDDDDDDD........DDDDDDDD....",
      "....DDDDDDDD........DDDDDDDD....",
      "....TTTTTTTT........TTTTTTTT...."]);

    // the lady, 14x22, two frames (idle, waving)
    def("lady", [
      "....KKKKKK....", "...KKKKKKKK...", "..KKKKKKKKKK..", "..KKSSSSSSKK..", "..KSSSSSSSSK..", "..KSSKSSSKSK..",
      "..KSSSSSSSSK..", "..KSSSSESSSK..", "..KKSSSSSSKK..", "...KK.SS.KK...", "...PPPPPPPP...", "..PPPPPPPPPP..",
      ".SPPPPPPPPPPS.", ".SPPPPPPPPPPS.", "..PPPPPPPPPP..", "..PPPPPPPPPP..", "..PPpPPPPpPP..", ".PPPPpPPpPPPP.",
      ".PPPPPPPPPPPP.", "PPPPPPPPPPPPPP", "..SS......SS..", "..HH......HH.."]);
    def("ladyWave", [
      "....KKKKKK..SS", "...KKKKKKKK.SS", "..KKKKKKKKKK.S", "..KKSSSSSSKK.S", "..KSSSSSSSSK.S", "..KSSKSSSKSKPS",
      "..KSSSSSSSSKP.", "..KSSSSESSSKP.", "..KKSSSSSSKKP.", "...KK.SS.KKP..", "...PPPPPPPPP..", "..PPPPPPPPPP..",
      ".SPPPPPPPPPP..", ".SPPPPPPPPPP..", "..PPPPPPPPPP..", "..PPPPPPPPPP..", "..PPpPPPPpPP..", ".PPPPpPPpPPPP.",
      ".PPPPPPPPPPPP.", "PPPPPPPPPPPPPP", "..SS......SS..", "..HH......HH.."]);

    // barrels: rolling (end-on, two spin frames) and side-on (the stack)
    def("barrelA", [
      "...NNNNNN...", ".NNNNnnNNNN.", ".NNNNnnNNNN.", "NNNNNnnNNNNN", "NnnnnnnnnnnN", "NnnnnnnnnnnN",
      "NNNNNnnNNNNN", ".NNNNnnNNNN.", ".NNNNnnNNNN.", "...NNNNNN..."]);
    def("barrelB", [
      "...NNNNNN...", ".NnNNNNNNnN.", ".NNnNNNNnNN.", "NNNNnNNnNNNN", "NNNNNnnNNNNN", "NNNNNnnNNNNN",
      "NNNNnNNnNNNN", ".NNnNNNNnNN.", ".NnNNNNNNnN.", "...NNNNNN..."]);
    def("blueA", [
      "...AAAAAA...", ".AAAAaaAAAA.", ".AAAAaaAAAA.", "AAAAAaaAAAAA", "AaaaaaaaaaaA", "AaaaaaaaaaaA",
      "AAAAAaaAAAAA", ".AAAAaaAAAA.", ".AAAAaaAAAA.", "...AAAAAA..."]);
    def("blueB", [
      "...AAAAAA...", ".AaAAAAAAaA.", ".AAaAAAAaAA.", "AAAAaAAaAAAA", "AAAAAaaAAAAA", "AAAAAaaAAAAA",
      "AAAAaAAaAAAA", ".AAaAAAAaAA.", ".AaAAAAAAaA.", "...AAAAAA..."]);
    def("barrelSide", [
      ".NNNNNNNNNNNNNN.", "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN",
      "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN", "NnNNNNnNNnNNNNnN", ".NNNNNNNNNNNNNN."]);
    def("blueSide", [
      ".AAAAAAAAAAAAAA.", "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA",
      "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA", "AaAAAAaAAaAAAAaA", ".AAAAAAAAAAAAAA."]);

    // oil drum (16x24) and its flame (16x12, two frames)
    def("drum", [
      "bbbbbbbbbbbbbbbb", "bCCCCCCCCCCCCCCb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbCCCbCCCbCCCbbb",
      "bbCbCbbCbbCbbbbb", "bbCbCbbCbbCbbbbb", "bbCCCbCCCbCCCbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb",
      "bCCCCCCCCCCCCCCb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb",
      "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bCCCCCCCCCCCCCCb", "bbbbbbbbbbbbbbbb"]);
    def("flameA", [
      "......O.........", ".....OY....O....", "....OYY...OY....", "...OYYYO..OYO...", "..OYYYYO.OYYO...", "..OYYYYYOYYYYO..",
      ".OYYYYYYYYYYYYO.", ".OYYYYYYYYYYYYO.", "OOYYYYYYYYYYYYOO", "OOOYYYYYYYYYYOOO", "ROOOOYYYYYYOOOOR", "RROOOOOOOOOOOORR"]);
    def("flameB", [
      "..........O.....", "....O....OY.....", "....YO..OYY.....", "...OYO.OYYYO....", "..OYYOOYYYYO....", ".OYYYYYYYYYYO...",
      ".OYYYYYYYYYYYO..", "OYYYYYYYYYYYYYO.", "OOYYYYYYYYYYYYOO", "OOOYYYYYYYYYYOOO", "ROOOOYYYYYYOOOOR", "RROOOOOOOOOOOORR"]);

    // fireball 16x16 (two frames), spring, pie tub, rivet, items, heart
    def("fireA", [
      "......YY........", ".....YYYY..O....", "....YYYYY.OO....", "...OYYYYYOOO....", "..OOYYYYYYOOO...", ".OOOYYYYYYYOOO..",
      ".OOYYYYYYYYYOO..", "OOOYYKKYYYKKYOOO", "OOOYYKKYYYKKYOOO", "OOOYYYYYYYYYYOOO", ".OOYYYYYYYYYOOO.", ".OOOYYYYYYYOOO..",
      "..OOOYYYYYOOO...", "...OOOOOOOOO....", "....OOOOOOO.....", "......OOO......."]);
    def("fireB", [
      "........YY......", "...O...YYYY.....", "...OO.YYYYY.....", "...OOOYYYYYO....", "..OOOYYYYYYOO...", ".OOOYYYYYYYOOO..",
      ".OOYYYYYYYYYOO..", "OOOYKKYYYKKYYOOO", "OOOYKKYYYKKYYOOO", "OOOYYYYYYYYYYOOO", ".OOYYYYYYYYYOOO.", ".OOOYYYYYYYOOO..",
      "..OOOYYYYYOOO...", "...OOOOOOOOO....", "....OOOOOOO.....", "......OOO......."]);
    def("fireBlue", [
      "......VV........", ".....VVVV..A....", "....VVVVV.AA....", "...AVVVVVAAA....", "..AAVVVVVVAAA...", ".AAAVVVVVVVAAA..",
      ".AAVVVVVVVVVAA..", "AAAVVKKVVVKKVAAA", "AAAVVKKVVVKKVAAA", "AAAVVVVVVVVVVAAA", ".AAVVVVVVVVVAAA.", ".AAAVVVVVVVAAA..",
      "..AAAVVVVVAAA...", "...AAAAAAAAA....", "....AAAAAAA.....", "......AAA......."]);
    def("springA", [
      "OOOOOOOOOOOOOOOO", "O..............O", ".YYYYYYYYYYYYYY.", "Y..............Y", ".YYYYYYYYYYYYYY.", "Y..............Y",
      ".YYYYYYYYYYYYYY.", "Y..............Y", ".YYYYYYYYYYYYYY.", "OOOOOOOOOOOOOOOO"]);
    def("springB", [
      "................", "................", "................", "OOOOOOOOOOOOOOOO", "O..............O", ".YYYYYYYYYYYYYY.",
      "Y..............Y", ".YYYYYYYYYYYYYY.", "Y..............Y", "OOOOOOOOOOOOOOOO"]);
    def("pie", [
      "WWWWWWWWWWWWWWWW", "GGGGGGGGGGGGGGGG", "gGGGGGGGGGGGGGGg", ".gGGGGGGGGGGGGg.", ".gGGGGGGGGGGGGg.", "..gggggggggggg.."]);
    def("rivet", ["YYYYYYYY", "YOOOOOOY", "YOYYYYOY", "YOYYYYOY", "YOYYYYOY", "YOYYYYOY", "YOOOOOOY", "YYYYYYYY"]);
    def("hat", ["......PPPP......", ".....PPPPPP.....", ".....PPPPPP.....", ".....PPPPPP.....", "PPPPPPPPPPPPPPPP", "PPPPPPPPPPPPPPPP", ".pppppppppppppp."]);
    def("purse", ["......pp........", ".....p..p.......", "....p....p......", "..PPPPPPPPPP....", "..PPPPPPPPPP....", "..PPPPYYPPPP....", "..PPPPPPPPPP....", "..PPPPPPPPPP...."]);
    def("umbrella", [".......RR.......", "....RRRRRRRR....", "..RRRARRRARRRR..", ".RRRAAARAAARRRR.", "RRRAAAAAAAAARRRR", ".......HH.......", ".......HH.......", "......HHH......."]);
    def("heart", ["..EE..EE..", ".EEEEEEEE.", "EEEEEEEEEE", "EEEEEEEEEE", ".EEEEEEEE.", "..EEEEEE..", "...EEEE...", "....EE...."]);
    def("heartL", ["..EE......", ".EEEE.....", "EEEEE.....", "EEEEE.....", ".EEEE.....", "..EEE.....", "...EE.....", "....E....."]);
    def("heartR", ["......EE..", ".....EEEE.", ".....EEEEE", ".....EEEEE", ".....EEEE.", ".....EEE..", ".....EE...", ".....E...."]);
    def("halo", ["...WWWW...", ".WW....WW.", "W........W", ".WW....WW.", "...WWWW..."]);
    def("life", ["..RRRR..", ".RRRRRRR", ".HHSSKS.", ".HSSSSS.", "..BRRB..", ".BRRRRB.", "..RRRR..", ".HH..HH."]);

    // 5x7 arcade font
    const FONT = {
      A: "0E,11,11,1F,11,11,11", B: "1E,11,11,1E,11,11,1E", C: "0E,11,10,10,10,11,0E", D: "1E,11,11,11,11,11,1E",
      E: "1F,10,10,1E,10,10,1F", F: "1F,10,10,1E,10,10,10", G: "0E,11,10,17,11,11,0F", H: "11,11,11,1F,11,11,11",
      I: "0E,04,04,04,04,04,0E", J: "07,02,02,02,02,12,0C", K: "11,12,14,18,14,12,11", L: "10,10,10,10,10,10,1F",
      M: "11,1B,15,15,11,11,11", N: "11,11,19,15,13,11,11", O: "0E,11,11,11,11,11,0E", P: "1E,11,11,1E,10,10,10",
      Q: "0E,11,11,11,15,12,0D", R: "1E,11,11,1E,14,12,11", S: "0F,10,10,0E,01,01,1E", T: "1F,04,04,04,04,04,04",
      U: "11,11,11,11,11,11,0E", V: "11,11,11,11,11,0A,04", W: "11,11,11,15,15,15,0A", X: "11,11,0A,04,0A,11,11",
      Y: "11,11,11,0A,04,04,04", Z: "1F,01,02,04,08,10,1F", "0": "0E,11,13,15,19,11,0E", "1": "04,0C,04,04,04,04,0E",
      "2": "0E,11,01,02,04,08,1F", "3": "1F,02,04,02,01,11,0E", "4": "02,06,0A,12,1F,02,02", "5": "1F,10,1E,01,01,11,0E",
      "6": "06,08,10,1E,11,11,0E", "7": "1F,01,02,04,08,08,08", "8": "0E,11,11,0E,11,11,0E", "9": "0E,11,11,0F,01,02,0C",
      " ": "00,00,00,00,00,00,00", "=": "00,00,1F,00,1F,00,00", "!": "04,04,04,04,04,00,04", "?": "0E,11,01,02,04,00,04",
      ".": "00,00,00,00,00,0C,0C", "-": "00,00,00,1F,00,00,00", ":": "00,0C,0C,00,0C,0C,00", ",": "00,00,00,00,0C,04,08",
      "(": "02,04,08,08,08,04,02", ")": "08,04,02,02,02,04,08", "/": "01,02,02,04,08,08,10", "'": "04,04,08,00,00,00,00",
      m: "00,00,1A,15,15,15,15", "+": "00,04,04,1F,04,04,00", "%": "19,1A,02,04,08,0B,13"
    };
    const glyphCache = {};
    function glyph(ch, color) {
      const key = ch + color; let c = glyphCache[key]; if (c) return c;
      const rows = (FONT[ch] || FONT["?"]).split(",");
      const oc = new OffscreenCanvas(8, 8), cc = oc.getContext("2d"); cc.fillStyle = color;
      for (let y = 0; y < 7; y++) { const bits = parseInt(rows[y], 16); for (let x = 0; x < 5; x++) if (bits & (16 >> x)) cc.fillRect(x, y, 1, 1); }
      glyphCache[key] = oc; return oc;
    }
    function text(s, x, y, color) { for (let i = 0; i < s.length; i++) { if (s[i] !== " ") fb.drawImage(glyph(s[i], color || "#ffffff"), x + i * 8, y); } }
    function textC(s, cxp, y, color) { text(s, Math.round(cxp - s.length * 4), y, color); }
    function spr(name, x, y, flip) { fb.drawImage(SPR[flip ? name + "_f" : name], Math.round(x), Math.round(y)); }

    // ---- audio (all synthesised) --------------------------------------------
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { AC = new C(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(AC.destination); } catch (_) { AC = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), gn = AC.createGain(); o.type = type || "square";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak || 0.2, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    function seq(notes, step, type, peak) { notes.forEach((f, i) => { if (f) tone(f, i * step, step * 0.9, type, peak); }); }
    const sfx = {
      step(i) { tone(i ? 98 : 131, 0, 0.05, "triangle", 0.25); },
      jump() { tone(420, 0, 0.18, "sine", 0.22, 980); tone(980, 0.17, 0.2, "sine", 0.18, 380); },
      score() { tone(1300, 0, 0.05, "square", 0.12); tone(1740, 0.05, 0.08, "square", 0.12); },
      big() { seq([1046, 1318, 1568, 2093], 0.06, "square", 0.14); },
      hammerNote(i) { const p = [392, 494, 587, 784, 587, 494, 392, 294]; tone(p[i % 8], 0, 0.09, "square", 0.1); },
      death() { seq([880, 830, 784, 740, 698, 659, 622, 587], 0.11, "square", 0.14); tone(240, 1.05, 0.5, "sine", 0.22, 70); },
      stomp() { tone(48, 0, 0.16, "sawtooth", 0.35, 30); tone(60, 0, 0.14, "sine", 0.4, 35); },
      start() { seq([659, 0, 659, 784, 0, 1047, 988, 784], 0.11, "square", 0.13); },
      clear() { seq([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.1, "square", 0.13); },
      howHigh() { seq([784, 659, 523, 659, 784, 1047, 0, 1047], 0.12, "square", 0.12); },
      rivet() { tone(620, 0, 0.06, "square", 0.14, 1100); },
      boing() { tone(320, 0, 0.16, "sine", 0.2, 110); },
      item() { seq([784, 988, 1175, 1568], 0.06, "square", 0.13); },
      fire() { tone(180, 0, 0.3, "sawtooth", 0.16, 40); },
      oneUp() { seq([1319, 1568, 2093, 1568, 2093, 2637], 0.07, "square", 0.13); },
      over() { seq([392, 370, 349, 330, 311, 294, 277, 262], 0.16, "square", 0.14); },
      ui() { tone(880, 0, 0.05, "square", 0.08); },
      thud() { tone(70, 0, 0.35, "sawtooth", 0.4, 25); tone(40, 0, 0.4, "sine", 0.4, 20); }
    };
    function applyMute() { if (master) master.gain.value = muted ? 0 : 0.7; }

    // ---- geometry -------------------------------------------------------------
    const SL = 1 / 24;   // girder gradient
    // platform: { x0, x1, y0, y1, kind, dir } — y is the walking surface, dir is belt direction
    function P(x0, x1, y0, y1, kind, extra) { return Object.assign({ x0, x1, y0, y1: y1 == null ? y0 : y1, kind: kind || "girder", dir: 0 }, extra || {}); }
    function surf(p, x) { return p.x0 === p.x1 ? p.y0 : p.y0 + (p.y1 - p.y0) * (x - p.x0) / (p.x1 - p.x0); }
    // downhill direction of a platform (sign of dy/dx), 0 for flat
    function downhill(p) { return Math.sign(p.y1 - p.y0); }
    let stage = null;   // built per screen
    const STAGE_NAMES = ["girders", "conveyors", "elevators", "rivets"];
    const STAGE_M = [25, 50, 75, 100];

    function buildGirders() {
      const G = [];
      G.push(P(0, 112, 248, 248, "flat"));                       // 0 bottom flat with the drum
      G.push(P(112, 224, 248, 248 - 112 * SL));                  // 1 bottom rise
      G.push(P(0, 208, 215 - 112 * SL, 215 + 96 * SL));          // 2
      G.push(P(16, 224, 182 + 96 * SL, 182 - 112 * SL));         // 3
      G.push(P(0, 208, 149 - 112 * SL, 149 + 96 * SL));          // 4
      G.push(P(16, 224, 116 + 96 * SL, 116 - 112 * SL));         // 5
      G.push(P(0, 112, 78, 78, "flat"));                         // 6 ape's flat
      G.push(P(112, 208, 78, 78 + 96 * SL));                     // 7 top slope
      G.push(P(88, 152, 52, 52, "flat"));                        // 8 the lady's perch
      const L = [];
      const lad = (x, a, b, broken) => L.push({ x, yTop: surf(G[b], x), yBot: surf(G[a], x), broken: broken || 0 });
      lad(184, 1, 2); lad(80, 0, 2, 12);
      lad(32, 2, 3); lad(112, 2, 3); lad(176, 2, 3, 10);
      lad(184, 3, 4); lad(112, 3, 4); lad(64, 3, 4, 10);
      lad(32, 4, 5); lad(96, 4, 5); lad(176, 4, 5, 12);
      lad(184, 5, 7); lad(60, 5, 6, 12);
      lad(100, 6, 8); lad(124, 7, 8);
      return {
        kind: "girders", plats: G, ladders: L, start: { x: 40, y: 248 },
        kong: { x: 20, y: 78 }, lady: { x: 112, y: 52 }, goal: 8,
        drum: { x: 8, y: 248 }, hammers: [{ x: 24, y: surf(G[3], 24) - 13 }, { x: 196, y: surf(G[5], 196) - 13 }],
        items: [], rivets: [], elevators: [], stack: { x: 0, y: 78 }
      };
    }
    function buildConveyors() {
      const G = [];
      G.push(P(0, 224, 248, 248, "flat"));                        // 0 floor
      G.push(P(0, 104, 215, 215, "conv", { pair: 2, side: -1 }));  // 1 lower belt left
      G.push(P(120, 224, 215, 215, "conv", { pair: 1, side: 1 })); // 2 lower belt right
      G.push(P(104, 120, 215, 215, "flat"));                      // 3 drum plinth
      G.push(P(32, 88, 182, 182, "flat"));                        // 4
      G.push(P(136, 192, 182, 182, "flat"));                      // 5
      G.push(P(92, 132, 182, 182, "flat"));                       // 6 centre shelf (hammer)
      G.push(P(0, 80, 149, 149, "conv", { pair: 8, side: -1 }));   // 7 mid belt left
      G.push(P(144, 224, 149, 149, "conv", { pair: 7, side: 1 })); // 8 mid belt right
      G.push(P(96, 128, 149, 149, "flat"));                       // 9 centre step
      G.push(P(0, 88, 116, 116, "conv", { pair: 11, side: -1 })); // 10 top belt left
      G.push(P(136, 224, 116, 116, "conv", { pair: 10, side: 1 }));// 11 top belt right
      G.push(P(88, 136, 116, 116, "flat"));                       // 12 ape's stand
      G.push(P(72, 152, 74, 74, "flat"));                         // 13 the lady's perch
      const L = [];
      const lad = (x, a, b, broken) => L.push({ x, yTop: surf(G[b], x), yBot: surf(G[a], x), broken: broken || 0 });
      lad(16, 0, 1); lad(208, 0, 2);
      lad(48, 1, 4); lad(176, 2, 5);
      lad(40, 4, 7); lad(184, 5, 8); lad(112, 6, 9);
      lad(24, 7, 10); lad(200, 8, 11);
      lad(80, 10, 13); lad(144, 11, 13);
      return {
        kind: "conveyors", plats: G, ladders: L, start: { x: 40, y: 248 },
        kong: { x: 92, y: 116 }, lady: { x: 112, y: 74 }, goal: 13,
        drum: { x: 104, y: 215 }, hammers: [{ x: 112, y: 182 - 13 }, { x: 200, y: 248 - 13 }],
        items: [], rivets: [], elevators: [], belts: [[1, 2], [7, 8], [10, 11]]
      };
    }
    function buildElevators() {
      const G = [];
      G.push(P(0, 48, 248, 248, "flat"));      // 0 start
      G.push(P(0, 48, 182, 182, "flat"));      // 1
      G.push(P(84, 100, 149, 149, "flat"));    // 2 mid ledge
      G.push(P(140, 224, 215, 215, "flat"));   // 3
      G.push(P(140, 224, 165, 165, "flat"));   // 4
      G.push(P(0, 176, 100, 100, "flat"));     // 5 the ape's lane
      G.push(P(176, 224, 83, 83, "flat"));     // 6 the lady's perch
      const L = [];
      const lad = (x, a, b, broken) => L.push({ x, yTop: surf(G[b], x), yBot: surf(G[a], x), broken: broken || 0 });
      lad(16, 0, 1); lad(152, 3, 4); lad(208, 4, 6);
      const E = [];
      for (let k = 0; k < 3; k++) { E.push({ x: 56, y: 240 - k * 50, dir: -1, on: false }); E.push({ x: 112, y: 110 + k * 50, dir: 1, on: false }); }
      return {
        kind: "elevators", plats: G, ladders: L, start: { x: 20, y: 248 },
        kong: { x: 4, y: 100 }, lady: { x: 200, y: 83 }, goal: 6,
        drum: null, hammers: [], items: [{ x: 36, y: 182, kind: "hat" }, { x: 172, y: 165, kind: "umbrella" }], rivets: [], elevators: E
      };
    }
    function buildRivets() {
      const G = [];
      G.push(P(0, 224, 248, 248, "flat"));     // 0 floor
      const RV = [];
      [215, 182, 149, 116].forEach((y, i) => {
        G.push(P(16, 64, y, y, "flat")); G.push(P(72, 152, y, y, "flat")); G.push(P(160, 208, y, y, "flat"));
        RV.push({ x: 64, y, row: i, gone: false }); RV.push({ x: 152, y, row: i, gone: false });
      });
      // rows: 1-3 (215), 4-6 (182), 7-9 (149), 10-12 (116)
      G.push(P(88, 136, 74, 74, "flat"));      // 13 the lady's perch
      const L = [];
      const lad = (x, a, b, broken) => L.push({ x, yTop: surf(G[b], x), yBot: surf(G[a], x), broken: broken || 0 });
      lad(32, 0, 1); lad(192, 0, 3);
      lad(88, 2, 5); lad(136, 2, 5);
      lad(32, 4, 7); lad(192, 6, 9);
      lad(88, 8, 11); lad(136, 8, 11);
      return {
        kind: "rivets", plats: G, ladders: L, start: { x: 40, y: 248 },
        kong: { x: 92, y: 116 }, lady: { x: 112, y: 74 }, goal: -1,
        drum: null, hammers: [{ x: 40, y: 182 - 13 }, { x: 184, y: 149 - 13 }],
        items: [{ x: 112, y: 215, kind: "purse" }, { x: 40, y: 149, kind: "hat" }, { x: 184, y: 182, kind: "umbrella" }],
        rivets: RV, elevators: []
      };
    }
    const BUILD = { girders: buildGirders, conveyors: buildConveyors, elevators: buildElevators, rivets: buildRivets };

    // rivet gap pieces are platforms too, removed when the rivet goes
    function rivetPlatform(rv) { return P(rv.x, rv.x + 8, rv.y, rv.y, "flat", { rivet: rv }); }

    // ---- game state -----------------------------------------------------------
    let state = "title";   // title | intro | howhigh | ready | play | dying | dead | clear | gameover
    let stateT = 0;        // frames in current state
    let started = false, frames = 0;
    let level = 1, stageIdx = 0, score = 0, best = store.get("best", 0), lives = 3, bonus = 5000, bonusTick = 0;
    let nextLife = 7000, stageFrames = 0, shake = 0;
    let kills = 0, maxStage = 0;
    const M = { x: 40, y: 248, dir: 1, vy: 0, air: false, airT: 0, lastMoveT: 99, onLad: null, hammer: 0, hamFrame: 0, walkT: 0, plat: null, fallFrom: 0, climbT: 0, jumped: 0, jumpScore: 0, onElev: null, dead: 0, halo: 0, ladderTop: false };
    let barrels = [], fires = [], pies = [], springs = [], pops = [], hammers = [], items = [], rivets = [];
    let kong = { x: 20, y: 78, frame: 0, t: 0, mode: "beat", vy: 0, fell: false };
    let lady = { x: 112, y: 52, t: 0 };
    let drumLit = false, throwT = 0, pieT = 0, springT = 0, fireT = 0, beltT = 0, barrelsThrown = 0, wildQueued = false;
    let clearPhase = 0, heart = 0, bonusCounted = false, oneUpFlash = 0, coachJumps = 0, plays = store.get("plays", 0);
    let inp = { left: false, right: false, up: false, down: false, jump: false, jumpBuf: 0 };

    function diff() {   // internal difficulty: 1..5, ramps with time on the stage and with level
      return clamp(level + Math.floor(stageFrames / (60 * 33)), 1, 5);
    }
    function addScore(n, x, y) {
      score += n; if (x != null) pops.push({ x, y, text: String(n), t: 0 });
      if (score >= nextLife) { lives++; nextLife = nextLife === 7000 ? 20000 : nextLife + 20000; sfx.oneUp(); oneUpFlash = 90; haptic("success"); }
      if (score > best) { best = score; store.set("best", best); }
      try { ctx.platform.setScore(score); } catch (_) {}
    }

    function loadStage() {
      stage = BUILD[STAGE_NAMES[stageIdx]]();
      barrels = []; fires = []; pies = []; springs = []; pops = [];
      hammers = stage.hammers.map((h) => ({ x: h.x, y: h.y, taken: false }));
      items = stage.items.map((it) => ({ x: it.x, y: it.y, kind: it.kind, taken: false }));
      rivets = stage.rivets.map((r) => Object.assign({}, r));
      for (const rv of rivets) stage.plats.push(rivetPlatform(rv));
      kong = { x: stage.kong.x, y: stage.kong.y, frame: 0, t: 0, mode: "beat", vy: 0, fell: false };
      lady = { x: stage.lady.x, y: stage.lady.y, t: 0 };
      drumLit = false; throwT = 90; pieT = 60; springT = 60; fireT = 120; beltT = 0; barrelsThrown = 0; wildQueued = false;
      stageFrames = 0; bonus = Math.min(8000, 4000 + 1000 * level); bonusTick = 0; bonusCounted = false; heart = 0;
      if (stage.belts) for (const [a, b] of stage.belts) { stage.plats[a].dir = -1; stage.plats[b].dir = 1; }
      if (stage.kind === "rivets") { for (let i = 0; i < 1 + Math.min(3, level); i++) spawnFire(i % 2 ? 216 : 8, 248, stage.plats[0]); }
      if (stage.kind === "elevators") { for (let i = 0; i < 1 + Math.min(2, Math.floor(level / 2) + 1); i++) spawnFire(150 + i * 40, i % 2 ? 165 : 215, stage.plats[i % 2 ? 4 : 3]); }
      resetPlayer();
    }
    function resetPlayer() {
      M.x = stage.start.x; M.y = stage.start.y; M.dir = 1; M.vy = 0; M.air = false; M.onLad = null; M.hammer = 0; M.walkT = 0;
      M.plat = platAt(M.x, M.y); M.fallFrom = M.y; M.onElev = null; M.jumpScore = 0; M.dead = 0; M.ladderTop = false; M.rivetOn = null; M.airT = 0; M.lastMoveT = 99; inp.jumpBuf = 0;
    }
    function respawn() {
      // hazards clear, rivets removed stay removed, hammers come back
      barrels = []; fires = []; pies = []; springs = []; pops = [];
      hammers = stage.hammers.map((h) => ({ x: h.x, y: h.y, taken: false }));
      drumLit = false; throwT = 90; pieT = 60; springT = 60; fireT = 120; barrelsThrown = 0;
      kong.mode = "beat"; kong.t = 0;
      bonus = Math.min(8000, 4000 + 1000 * level); bonusTick = 0;
      if (stage.kind === "rivets") { for (let i = 0; i < 1 + Math.min(3, level); i++) spawnFire(i % 2 ? 216 : 8, 248, stage.plats[0]); }
      if (stage.kind === "elevators") { for (let i = 0; i < 1 + Math.min(2, Math.floor(level / 2) + 1); i++) spawnFire(150 + i * 40, i % 2 ? 165 : 215, stage.plats[i % 2 ? 4 : 3]); }
      resetPlayer();
    }

    // platform under a point: the one whose surface is within tol below the feet
    function platAt(x, y, tol) {
      tol = tol == null ? 3 : tol; let bestP = null, bd = 1e9;
      for (const p of stage.plats) {
        if (x < p.x0 || x > p.x1) continue; if (p.rivet && p.rivet.gone) continue;
        const s = surf(p, x), d = s - y; if (d >= -tol && d <= tol && Math.abs(d) < bd) { bd = Math.abs(d); bestP = p; }
      }
      return bestP;
    }
    // first surface strictly below y (for landing checks): returns {p, y}
    function landing(x, yPrev, yNow) {
      let hit = null;
      for (const p of stage.plats) {
        if (x < p.x0 || x > p.x1) continue; if (p.rivet && p.rivet.gone) continue;
        const s = surf(p, x); if (s >= yPrev - 0.01 && s <= yNow + 0.01 && (!hit || s < hit.y)) hit = { p, y: s };
      }
      for (const e of stage.elevators) {
        if (x < e.x || x > e.x + 16) continue;
        if (e.y >= yPrev - 0.01 && e.y <= yNow + 0.01 && (!hit || e.y < hit.y)) hit = { p: null, elev: e, y: e.y };
      }
      return hit;
    }
    function ladderAt(x, y, fromTop) {
      for (const l of stage.ladders) {
        if (Math.abs(x - l.x) > 4) continue;
        if (fromTop) { if (!l.broken && Math.abs(y - l.yTop) < 3) return l; }
        else if (Math.abs(y - l.yBot) < 3) return l;
      }
      return null;
    }

    // ---- hazards ----------------------------------------------------------------
    function spawnBarrel(blue, wild) {
      const d = diff();
      const b = { x: kong.x + 44, y: kong.y, dir: 1, blue: !!blue, wild: !!wild, plat: null, mode: wild ? "fall" : "roll", vy: 0, vx: 0, spin: 0, passed: false, speed: 1.25 + 0.08 * (d - 1) };
      if (wild) { b.x = kong.x + 26; b.vy = 0; b.vx = 0.55 * (M.x > b.x ? 1 : -1); b.mode = "wild"; }
      else b.plat = stage.plats[6];
      barrels.push(b); barrelsThrown++;
    }
    function spawnFire(x, y, plat) {
      const d = diff();
      fires.push({ x, y, plat: plat || platAt(x, y, 4) || stage.plats[0], dir: chance(0.5) ? 1 : -1, mode: "roam", speed: 0.4 + 0.07 * (d - 1), t: 0, turnT: rnd(40, 160), ladder: null, ladDir: 0, frame: 0, born: 0 });
      sfx.fire();
    }
    function maxFires() {
      const d = diff();
      if (stage.kind === "girders") return Math.min(4, (d >= 3 ? 2 : 1) + (level >= 3 ? 1 : 0));
      if (stage.kind === "conveyors") return Math.min(4, 1 + Math.floor((level + 1) / 2));
      return 4;
    }
    function spawnPie(belt) {
      // moving outward: born next to the centre; moving inward: born at the screen edge
      const x = belt.dir === belt.side ? (belt.side < 0 ? belt.x1 - 2 : belt.x0 + 2) : (belt.side < 0 ? belt.x0 + 2 : belt.x1 - 2);
      pies.push({ x, y: belt.y0, belt, mode: "belt", vy: 0, passed: false });
    }
    function spawnSpring() {
      springs.push({ x: kong.x + 44, y: kong.y, vx: 1.25 + 0.12 * (diff() - 1), vy: -2.6, mode: "bounce", frame: 0, passed: false });
    }

    // ---- collision helpers --------------------------------------------------------
    function hitsPlayer(x0, y0, x1, y1) {
      return x1 > M.x - 3 && x0 < M.x + 3 && y1 > M.y - 12 && y0 < M.y;
    }
    function hammerBox() {
      if (!M.hammer) return null;
      const up = M.hamFrame === 0;
      return up ? { x0: M.x - 6, y0: M.y - 27, x1: M.x + 6, y1: M.y - 15 } : { x0: M.x + (M.dir > 0 ? 6 : -18), y0: M.y - 14, x1: M.x + (M.dir > 0 ? 18 : -6), y1: M.y - 2 };
    }
    function boxHit(a, x0, y0, x1, y1) { return a && x1 > a.x0 && x0 < a.x1 && y1 > a.y0 && y0 < a.y1; }
    function hammerScore() { const r = Math.random(); return r < 0.5 ? 300 : r < 0.85 ? 500 : 800; }
    function itemScore() { return level === 1 ? 300 : level === 2 ? 500 : 800; }
    // jumped over: hazard passes under the player's feet while airborne
    function jumpedOver(h, prevDx) {
      if (!M.air || h.passed) return false;
      const dx = h.x - M.x;
      if (Math.sign(dx) !== Math.sign(prevDx) && prevDx !== 0 && h.y > M.y && h.y - M.y < 28) { h.passed = true; return true; }
      return false;
    }
    const TIPS = {
      barrel: ["JUMP TOWARD A BARREL,", "NOT STRAIGHT UP"],
      fall: ["A DROP OF MORE THAN", "YOUR HEIGHT IS FATAL"],
      fire: ["FIREBALLS CLIMB LADDERS.", "THE HAMMER SMASHES THEM"],
      time: ["THE BONUS IS A CLOCK.", "KEEP CLIMBING"],
      ape: ["STAY CLEAR OF THE APE", "ON THE TOP GIRDER"],
      pie: ["BELTS REVERSE. PIES", "DROP OFF THE ENDS"],
      spring: ["CLIMB THE LAST LADDER", "RIGHT AFTER A SPRING FALLS"],
      elevator: ["STEP OFF A CAR BEFORE", "IT REACHES THE END"]
    };
    let lastCause = "", tipsShown = store.get("tips", 0);
    function die(cause) {
      if (state !== "play") return;
      lastCause = cause; if (TIPS[cause] && tipsShown < 8) { tipsShown++; store.set("tips", tipsShown); }
      state = "dying"; stateT = 0; M.dead = 0; M.hammer = 0; sfx.death(); haptic("heavy"); shake = 6;
      try { ctx.platform.fail({ cause, score, level, stage: STAGE_M[stageIdx] + "m" }); } catch (_) {}
    }

    // ---- player update ------------------------------------------------------------
    const WALK = 1.0, CLIMB = 0.6, GRAV = 0.145, JUMPV = 2.45, FALL_DEATH = 24;
    function updatePlayer() {
      const belt = M.plat && M.plat.kind === "conv" ? M.plat.dir * (0.38 + 0.05 * (diff() - 1)) : 0;
      if (M.onLad) {
        const l = M.onLad;
        if (inp.up) { M.y -= CLIMB; M.climbT++; }
        if (inp.down) { M.y += CLIMB; M.climbT++; }
        const limitTop = l.broken ? l.yBot - l.broken : l.yTop;
        if (M.y < limitTop) M.y = limitTop;
        if (!l.broken && M.y <= l.yTop + 0.01) {   // over the top
          if (inp.up || M.ladderTop) { M.y = l.yTop; M.onLad = null; M.plat = platAt(M.x, M.y, 4); M.fallFrom = M.y; M.ladderTop = false; }
        }
        if (M.y >= l.yBot) { M.y = l.yBot; M.onLad = null; M.plat = platAt(M.x, M.y, 4); M.fallFrom = M.y; }
        return;
      }
      if (M.air) {
        if (!M.jumped && M.airT < 8 && (inp.left || inp.right)) { M.dir = inp.left ? -1 : 1; M.jumped = 1; }
        M.airT++;
        M.vy += GRAV; const yPrev = M.y; M.y += M.vy; M.x += M.dir * (M.jumped ? WALK : 0);
        M.x = clamp(M.x, 4, FW - 4);
        if (M.vy > 0) {
          const hit = landing(M.x, yPrev, M.y);
          if (hit) {
            M.y = hit.y; M.air = false; M.vy = 0; M.plat = hit.p; M.onElev = hit.elev || null; M.jumped = 0;
            if (M.y - M.fallFrom > FALL_DEATH) { die("fall"); return; }
            if (M.jumpScore) { const n = M.jumpScore === 1 ? 100 : M.jumpScore === 2 ? 300 : 500; addScore(n, M.x, M.y - 24); sfx.score(); M.jumpScore = 0; coachJumps++; }
            for (const b of barrels) b.passed = false; for (const f of fires) f.passed = false; for (const s of springs) s.passed = false; for (const p of pies) p.passed = false;
          }
        }
        if (M.y > FH + 8) { die("fall"); }
        return;
      }
      // on the ground
      if (M.onElev) { M.y = M.onElev.y; M.x = clamp(M.x, M.onElev.x + 1, M.onElev.x + 15); if (M.onElev.y < 102 || M.onElev.y > 248) { die("elevator"); return; } }
      let moving = false;
      if (!M.hammer && inp.up) {
        const l = ladderAt(M.x, M.y, false);
        if (l) { M.onLad = l; M.x = l.x; M.plat = null; M.onElev = null; return; }
      }
      if (!M.hammer && inp.down) {
        const l = ladderAt(M.x, M.y, true);
        if (l) { M.onLad = l; M.x = l.x; M.y = l.yTop + 0.5; M.plat = null; M.onElev = null; return; }
      }
      if (inp.left) { M.dir = -1; M.x -= WALK; moving = true; }
      else if (inp.right) { M.dir = 1; M.x += WALK; moving = true; }
      M.x += belt;
      M.x = clamp(M.x, 4, FW - 4);
      if (M.onElev) {
        if (M.x < M.onElev.x - 2 || M.x > M.onElev.x + 18) { M.onElev = null; M.air = true; M.airT = 99; M.vy = 0; M.fallFrom = M.y; M.jumped = 0; }
      } else {
        const p = platAt(M.x, M.y, 4);
        if (p) { M.plat = p; M.y = surf(p, M.x); }
        else { M.air = true; M.airT = 99; M.vy = 0; M.fallFrom = M.y; M.plat = null; M.jumped = 0; }   // walked off an edge
      }
      if (moving && !M.air) { M.walkT++; if (M.walkT % 9 === 0) sfx.step(M.walkT % 18 === 0 ? 1 : 0); M.lastMoveT = 0; } else { M.walkT = 0; M.lastMoveT++; }
      if (inp.jumpBuf > 0 && !M.hammer && !M.air) {
        inp.jumpBuf = 0; M.air = true; M.airT = 0; M.vy = -JUMPV; M.fallFrom = M.y; M.jumped = moving || M.lastMoveT <= 10 ? 1 : 0; M.onElev = null; M.plat = null; sfx.jump(); haptic("light");
      }
      inp.jumpBuf = Math.max(0, inp.jumpBuf - 1);
      // hammer
      if (M.hammer > 0) {
        M.hammer--; if (frames % 8 === 0) { M.hamFrame = M.hamFrame ? 0 : 1; } if (frames % 7 === 0) sfx.hammerNote(Math.floor(frames / 7));
      }
      // pick things up
      for (const h of hammers) if (!h.taken && Math.abs(h.x - M.x) < 8 && M.y - 14 < h.y + 10 && M.y > h.y) { h.taken = true; M.hammer = 60 * 9.5; M.hamFrame = 0; sfx.big(); haptic("medium"); }
      for (const it of items) if (!it.taken && Math.abs(it.x - M.x) < 10 && Math.abs(it.y - M.y) < 10) { it.taken = true; addScore(itemScore(), it.x, it.y - 16); sfx.item(); haptic("light"); }
      // rivets: walking over or jumping over one pulls it
      if (stage.kind === "rivets") {
        if (M.rivetOn) {
          const rv = M.rivetOn;
          if (Math.abs(M.x - (rv.x + 4)) >= 6 || Math.abs(M.y - rv.y) > 2 || M.air) { M.rivetOn = null; pullRivet(rv); }
        } else for (const rv of rivets) {
          if (!rv.gone && Math.abs(M.x - (rv.x + 4)) < 3 && Math.abs(M.y - rv.y) < 2) M.rivetOn = rv;
        }
      }
      // reached the lady
      if (stage.goal >= 0 && M.plat === stage.plats[stage.goal] && Math.abs(M.x - lady.x) < 40) { state = "clear"; stateT = 0; clearPhase = 0; heart = 0; M.dir = 1; }
    }
    // jumping over a hazard while airborne (called after hazards move)
    function scoreJumpsOver(list) { for (const h of list) { const prev = h.prevDx; h.prevDx = h.x - M.x; if (prev !== undefined && jumpedOver(h, prev)) { M.jumpScore++; } } }
    function jumpOverCheck(list) {
      if (!M.air) return;
      for (const h of list) {
        const dx = h.x - M.x;
        if (h.prevDx !== undefined && !h.passed && Math.sign(dx) !== Math.sign(h.prevDx) && h.y > M.y - 2 && h.y - M.y < 30) { h.passed = true; M.jumpScore++; }
        h.prevDx = dx;
      }
    }
    function pullRivet(rv) {
      if (rv.gone) return;
      rv.gone = true; addScore(100, rv.x + 4, rv.y - 20); sfx.rivet(); haptic("light"); kills++;
      if (rivets.every((r) => r.gone)) { state = "clear"; stateT = 0; clearPhase = 0; heart = 0; }
    }
    // rivets: also pulled by jumping over
    function rivetJumpCheck() {
      if (stage.kind !== "rivets" || !M.air) return;
      for (const rv of rivets) {
        if (rv.gone) continue; const dx = rv.x + 4 - M.x;
        if (rv.prevDx !== undefined && Math.sign(dx) !== Math.sign(rv.prevDx) && Math.abs(M.y - rv.y) < 22 && M.y <= rv.y + 1) pullRivet(rv);
        rv.prevDx = dx;
      }
    }

    // ---- the ape ----------------------------------------------------------------------
    function updateKong() {
      kong.t++;
      if (stage.kind === "girders") {
        const d = diff(), interval = Math.max(70, 160 - 20 * (d - 1));
        if (kong.mode === "beat") {
          kong.frame = Math.floor(kong.t / 16) % 2;
          if (--throwT <= 0) { kong.mode = "grab"; kong.t = 0; }
        } else if (kong.mode === "grab") {
          if (kong.t > 22) { kong.mode = "throw"; kong.t = 0; }
        } else if (kong.mode === "throw") {
          if (kong.t === 6) {
            const blue = barrelsThrown === 0 || chance(0.12);
            const wild = !blue && d >= 2 && chance(0.1 + 0.03 * d);
            spawnBarrel(blue, wild);
          }
          if (kong.t > 20) { kong.mode = "beat"; kong.t = 0; throwT = interval * rnd(0.85, 1.15); }
        }
      } else {
        kong.frame = Math.floor(kong.t / 18) % 2;
      }
      lady.t++;
    }

    // ---- hazard updates ------------------------------------------------------------------
    function updateBarrels() {
      const hb = hammerBox();
      for (const b of barrels) {
        b.spin++;
        if (b.mode === "roll") {
          b.x += b.dir * b.speed;
          const p = b.plat;
          if (b.x < p.x0 || b.x > p.x1) {
            // continue on an adjoining platform at the same height, otherwise fall
            const q = platAt(b.x, surf(p, clamp(b.x, p.x0, p.x1)), 3);
            if (q && q !== p) { b.plat = q; if (downhill(q)) b.dir = downhill(q); }
            else if (b.x < -8 && p === stage.plats[0]) { b.mode = "gone"; if (b.blue && !drumLit) { drumLit = true; } if (b.blue && fires.length < maxFires()) spawnFire(stage.drum.x + 8, stage.drum.y, stage.plats[0]); }
            else { b.mode = "fall"; b.vy = 0; }
          } else {
            b.y = surf(p, b.x);
            // take a ladder down?
            for (const l of stage.ladders) {
              if (l.broken || Math.abs(l.yTop - b.y) > 2) continue;
              const before = b.x - b.dir * b.speed, after = b.x;
              if ((before - l.x) * (after - l.x) <= 0) {
                const below = M.y > b.y + 4 && Math.abs(M.x - l.x) < 60, d = diff();
                if (chance(below ? 0.3 + 0.05 * (d - 1) : 0.12)) { b.mode = "ladder"; b.x = l.x; b.lad = l; }
              }
            }
          }
        } else if (b.mode === "ladder") {
          b.y += b.speed * 1.2;
          if (b.y >= b.lad.yBot) { b.y = b.lad.yBot; const q = platAt(b.x, b.y, 3); b.plat = q || stage.plats[0]; b.mode = "roll"; const dh = downhill(b.plat); b.dir = dh || (b.plat === stage.plats[0] ? -1 : b.dir); }
        } else if (b.mode === "fall") {
          b.vy += 0.2; const yp = b.y; b.y += b.vy;
          const hit = landing(b.x, yp, b.y);
          if (hit && hit.p) { b.y = hit.y; b.plat = hit.p; b.mode = "roll"; const dh = downhill(hit.p); b.dir = dh || (hit.p === stage.plats[0] ? -1 : b.dir); }
          if (b.y > FH + 12) b.mode = "gone";
        } else if (b.mode === "wild") {
          b.vy += 0.2; const yp = b.y; b.y += b.vy; b.x += b.vx;
          if (b.x < 6 || b.x > FW - 6) b.vx = -b.vx;
          const hit = landing(b.x, yp, b.y);
          if (hit && hit.p && b.vy > 0) {
            if (hit.p === stage.plats[0] || hit.p === stage.plats[1]) { b.y = hit.y; b.plat = hit.p; b.mode = "roll"; b.dir = -1; }
            else { b.y = hit.y; b.vy = -1.6; b.vx = 0.6 * (M.x > b.x ? 1 : -1); sfx.step(1); }
          }
          if (b.y > FH + 12) b.mode = "gone";
        }
        // hammer
        if (hb && boxHit(hb, b.x - 5, b.y - 10, b.x + 5, b.y)) { b.mode = "gone"; const n = hammerScore(); addScore(n, b.x, b.y - 16); sfx.big(); haptic("medium"); kills++; continue; }
        if (b.mode !== "gone" && hitsPlayer(b.x - 4, b.y - 7, b.x + 4, b.y)) { die("barrel"); }
      }
      jumpOverCheck(barrels);
      barrels = barrels.filter((b) => b.mode !== "gone");
    }
    function updateFires() {
      const hb = hammerBox(), d = diff();
      for (const f of fires) {
        f.t++; f.born++; if (f.t % 6 === 0) f.frame = f.frame ? 0 : 1;
        const scared = M.hammer > 0;
        if (f.mode === "roam") {
          const p = f.plat; if (!p) { f.plat = platAt(f.x, f.y, 6) || stage.plats[0]; continue; }
          if (--f.turnT <= 0) {
            f.turnT = rnd(50, 180);
            const toward = Math.sign(M.x - f.x) || 1;
            f.dir = scared ? -toward : (chance(0.65) ? toward : -toward);
          }
          f.x += f.dir * f.speed * (scared ? 1.3 : 1);
          if (f.x < p.x0 + 4 || f.x > p.x1 - 4) { f.x = clamp(f.x, p.x0 + 4, p.x1 - 4); f.dir = -f.dir; }
          f.y = surf(p, f.x);
          // ladders, both ways
          if (f.born > 60) for (const l of stage.ladders) {
            if (l.broken || Math.abs(f.x - l.x) > 1.2) continue;
            const atTop = Math.abs(l.yTop - f.y) < 2, atBot = Math.abs(l.yBot - f.y) < 2;
            if (!atTop && !atBot) continue;
            const wantUp = M.y < f.y - 8, wantDown = M.y > f.y + 8;
            const pr = (atBot && wantUp) || (atTop && wantDown) ? 0.5 : 0.12;
            if (chance(pr * (0.6 + 0.1 * d))) { f.mode = "ladder"; f.ladder = l; f.ladDir = atBot ? -1 : 1; f.x = l.x; }
          }
        } else {
          f.y += f.ladDir * f.speed * 0.9;
          if (f.ladDir < 0 && f.y <= f.ladder.yTop) { f.y = f.ladder.yTop; f.mode = "roam"; f.plat = platAt(f.x, f.y, 3) || f.plat; f.turnT = 20; }
          if (f.ladDir > 0 && f.y >= f.ladder.yBot) { f.y = f.ladder.yBot; f.mode = "roam"; f.plat = platAt(f.x, f.y, 3) || f.plat; f.turnT = 20; }
        }
        if (hb && boxHit(hb, f.x - 6, f.y - 13, f.x + 6, f.y)) { f.gone = true; const n = hammerScore(); addScore(n, f.x, f.y - 18); sfx.big(); haptic("medium"); kills++; continue; }
        if (hitsPlayer(f.x - 5, f.y - 12, f.x + 5, f.y)) die("fire");
      }
      jumpOverCheck(fires);
      fires = fires.filter((f) => !f.gone);
    }
    function updateBelts() {
      const d = diff();
      if (stage.kind !== "conveyors") return;
      // each belt pair flips direction on its own clock
      beltT++;
      stage.belts.forEach(([a, b], i) => {
        const period = [420, 300, 360][i];
        if ((beltT + i * 97) % period === 0) { stage.plats[a].dir = -stage.plats[a].dir; stage.plats[b].dir = -stage.plats[b].dir; }
      });
      if (--pieT <= 0) {
        pieT = Math.max(55, 130 - 14 * (d - 1)) * rnd(0.8, 1.2);
        const pair = stage.belts[chance(0.55) ? 2 : 0];
        spawnPie(stage.plats[pair[chance(0.5) ? 0 : 1]]);
      }
      if (--fireT <= 0) { fireT = rnd(300, 600); if (fires.length < maxFires()) spawnFire(112, 248, stage.plats[0]); }
      const hb = hammerBox();
      for (const p of pies) {
        if (p.mode === "belt") {
          const sp = 0.38 + 0.05 * (d - 1);
          p.x += p.belt.dir * sp;
          if (p.x < p.belt.x0 - 6 || p.x > p.belt.x1 + 6) {
            // off the outer end: drop; into the middle: swallowed by the drum or the ape
            if ((p.belt.side < 0 && p.x < p.belt.x0) || (p.belt.side > 0 && p.x > p.belt.x1)) { p.mode = "fall"; p.vy = 0; }
            else p.mode = "gone";
          }
        } else if (p.mode === "fall") { p.vy += 0.2; p.y += p.vy; if (p.y > FH + 8) p.mode = "gone"; }
        if (hb && boxHit(hb, p.x - 7, p.y - 6, p.x + 7, p.y)) { p.mode = "gone"; const n = hammerScore(); addScore(n, p.x, p.y - 16); sfx.big(); kills++; continue; }
        if (p.mode !== "gone" && hitsPlayer(p.x - 6, p.y - 5, p.x + 6, p.y)) die("pie");
      }
      jumpOverCheck(pies);
      pies = pies.filter((p) => p.mode !== "gone");
    }
    function updateElevators() {
      if (stage.kind !== "elevators") return;
      const d = diff(), sp = 0.42 + 0.05 * (d - 1);
      for (const e of stage.elevators) {
        e.y += e.dir * sp;
        if (e.dir < 0 && e.y < 100) { e.y += 150; if (M.onElev === e) { die("elevator"); } }
        if (e.dir > 0 && e.y > 250) { e.y -= 150; if (M.onElev === e) { die("elevator"); } }
      }
      if (--springT <= 0) { springT = Math.max(75, 160 - 18 * (d - 1)) * rnd(0.85, 1.2); spawnSpring(); }
      for (const s of springs) {
        s.frame = s.vy < -0.5 ? 1 : 0;
        if (s.mode === "bounce") {
          s.vy += 0.17; s.x += s.vx; s.y += s.vy;
          if (s.y >= 100 && s.vy > 0 && s.x < 176) { s.y = 100; s.vy = -2.6; if (Math.abs(s.x - M.x) < 90) sfx.boing(); }
          if (s.x >= 176) { s.mode = "drop"; s.vx = 0.3; }
        } else { s.vy += 0.2; s.y += s.vy; s.x += s.vx; if (s.y > FH + 12) s.mode = "gone"; }
        if (s.mode !== "gone" && hitsPlayer(s.x - 7, s.y - 9, s.x + 7, s.y)) die("spring");
      }
      jumpOverCheck(springs);
      springs = springs.filter((s) => s.mode !== "gone");
    }
    function updateBonus() {
      if (++bonusTick >= 120) { bonusTick = 0; bonus -= 100; if (bonus <= 0) { bonus = 0; die("time"); } }
    }
    function updateGirdersStage() {
      if (stage.kind !== "girders") return;
      // once the drum is lit it keeps breeding fireballs slowly
      if (drumLit && --fireT <= 0) { fireT = rnd(480, 900); if (fires.length < maxFires()) spawnFire(stage.drum.x + 8, stage.drum.y, stage.plats[0]); }
    }

    // ---- state machine ----------------------------------------------------------------
    function startGame() {
      level = 1; stageIdx = 0; score = 0; lives = 3; nextLife = 7000; kills = 0; maxStage = 0;
      loadStage(); coachJumps = 0; lastCause = ""; plays++; store.set("plays", plays);
      if (plays <= 3) { state = "howto"; stateT = 0; } else { state = "intro"; stateT = 0; sfx.start(); }
      try { ctx.platform.setScore(0); } catch (_) {}
    }
    function beginStage() { loadStage(); lastCause = ""; state = "ready"; stateT = 0; sfx.start(); }
    function nextStage() {
      stageIdx++; if (stageIdx >= 4) { stageIdx = 0; level++; }
      maxStage = Math.max(maxStage, (level - 1) * 4 + stageIdx);
      state = "howhigh"; stateT = 0; sfx.howHigh();
      try { ctx.platform.milestone("stage", { level, stage: STAGE_M[stageIdx] + "m" }); } catch (_) {}
    }
    function gameOver() {
      state = "gameover"; stateT = 0; sfx.over();
      try {
        ctx.memory.record("score").submit(score, { label: score.toLocaleString("en-US") + " pts" }).catch(() => {});
        ctx.memory.record("height").submit((level - 1) * 100 + STAGE_M[stageIdx], { label: "L" + level + " " + STAGE_M[stageIdx] + "m" }).catch(() => {});
        ctx.platform.complete({ score, level, stage: STAGE_M[stageIdx] + "m", kills });
      } catch (_) {}
    }

    function tick() {
      frames++; stateT++;
      if (shake > 0) shake--;
      if (oneUpFlash > 0) oneUpFlash--;
      for (const p of pops) p.t++; pops = pops.filter((p) => p.t < 50);
      switch (state) {
        case "title": break;
        case "howto": if (stateT > 60 * 9) { state = "intro"; stateT = 0; sfx.start(); } break;
        case "intro": {
          // the ape stamps and the girders sag into their slopes
          if (stateT === 40 || stateT === 70 || stateT === 100 || stateT === 130) { sfx.stomp(); shake = 5; haptic("medium"); }
          if (stateT > 200) { state = "howhigh"; stateT = 0; sfx.howHigh(); }
          break;
        }
        case "howhigh": if (stateT > 150) beginStage(); break;
        case "ready": lady.t++; if (stateT > 70) { state = "play"; stateT = 0; try { ctx.platform.interact(); } catch (_) {} } break;
        case "play": {
          stageFrames++;
          updatePlayer(); if (state !== "play") break;
          updateKong(); updateGirdersStage(); updateBarrels(); if (state !== "play") break;
          updateFires(); if (state !== "play") break;
          updateBelts(); if (state !== "play") break;
          updateElevators(); if (state !== "play") break;
          rivetJumpCheck(); updateBonus();
          // the ape himself
          if (hitsPlayer(kong.x + 10, kong.y - 30, kong.x + 30, kong.y)) die("ape");
          break;
        }
        case "dying": {
          M.dead++;
          if (stateT > 95) { state = "dead"; stateT = 0; }
          break;
        }
        case "dead": {
          if (stateT > 75) { lives--; if (lives < 0) gameOver(); else { respawn(); state = "ready"; stateT = 0; sfx.start(); } }
          break;
        }
        case "clear": {
          // 0: pause + heart, 1: the ape leaves with the lady / falls, 2: bonus counts in
          if (stateT === 1) { sfx.clear(); haptic("success"); }
          if (stage.kind === "rivets") {
            if (stateT === 30) { kong.mode = "beat"; }
            if (stateT > 60 && !kong.fell) { kong.vy += 0.18; kong.y += kong.vy; if (kong.y >= 248) { kong.y = 248; kong.fell = true; sfx.thud(); shake = 8; haptic("heavy"); } }
            if (stateT > 100) heart = 1;
            if (kong.fell && stateT > 160 && !bonusCounted) { bonusCounted = true; addScore(bonus); bonus = 0; }
            if (stateT > 230) { nextStage(); }
          } else {
            if (stateT > 30) heart = 1;
            if (stateT === 80) { kong.x = lady.x - 16; kong.y = lady.y; heart = 0; }
            if (stateT > 80) { kong.y -= 0.9; lady.y = kong.y - 16; }
            if (stateT > 100 && !bonusCounted) { bonusCounted = true; addScore(bonus); bonus = 0; }
            if (stateT > 190) { nextStage(); }
          }
          break;
        }
        case "gameover": if (stateT > 240) { state = "title"; stateT = 0; } break;
      }
    }

    // ---- drawing --------------------------------------------------------------------
    const GIRDER = "#f24a3c", GDOT = "#ffb4b4", LADDER = "#1ce8ff";
    function drawGirder(p, tilt) {
      const mid = (p.y0 + p.y1) / 2;
      for (let x = Math.round(p.x0); x < p.x1; x++) {
        const yy = Math.round(mid + (surf(p, x) - mid) * tilt);
        fb.fillStyle = GIRDER; fb.fillRect(x, yy, 1, 8);
        let ph = ((x - Math.round(p.x0)) % 8 + 8) % 8;
        if (p.kind === "conv") { const off = Math.floor(frames * 0.5 * p.dir * 0.8); ph = (((x + off) % 8) + 8) % 8; }
        if (ph === 1 || ph === 2) { fb.fillStyle = GDOT; fb.fillRect(x, yy + 1, 1, 1); fb.fillRect(x, yy + 5, 1, 1); }
        if (ph === 5 || ph === 6) { fb.fillStyle = GDOT; fb.fillRect(x, yy + 3, 1, 1); }
      }
      if (p.kind === "conv") {   // rollers at the ends
        fb.fillStyle = "#f8d820";
        fb.fillRect(p.x0, p.y0 + 1, 3, 6); fb.fillRect(p.x1 - 3, p.y0 + 1, 3, 6);
      }
    }
    function drawLadder(l) {
      fb.fillStyle = LADDER;
      const segs = l.broken ? [[l.yTop, l.yTop + 9], [l.yBot - l.broken, l.yBot + 8]] : [[l.yTop, l.yBot + 8]];
      for (const [a, b] of segs) {
        const y0 = Math.round(a), y1 = Math.round(b);
        fb.fillRect(l.x - 4, y0, 1, y1 - y0); fb.fillRect(l.x + 3, y0, 1, y1 - y0);
        for (let y = y0 + 2; y < y1; y += 4) fb.fillRect(l.x - 3, y, 6, 1);
      }
    }
    function drawKong(x, y, mode, frame) {
      spr("kong", x, y - 32);
      if (mode === "beat") {
        spr(frame ? "armUp" : "armDown", x - 2, frame ? y - 36 : y - 24);
        spr(frame ? "armDown" : "armUp", x + 34, frame ? y - 24 : y - 36);
      } else if (mode === "grab") {
        spr("armDown", x - 4, y - 22); spr("armDown", x + 34, y - 24);
        spr("barrelSide", x - 12, y - 14);
      } else if (mode === "throw") {
        spr("armDown", x - 2, y - 24); spr("armOut", x + 36, y - 22);
      }
    }
    function drawStage(tilt) {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      // elevator cables first
      if (stage.kind === "elevators") {
        fb.fillStyle = "#1ce8ff";
        for (const xx of [64, 120]) for (let y = 100; y < 250; y += 3) fb.fillRect(xx, y, 1, 1);
        fb.fillStyle = "#f8d820"; fb.fillRect(58, 92, 12, 6); fb.fillRect(114, 92, 12, 6);
      }
      if (stage.drum) {
        spr("drum", stage.drum.x, stage.drum.y - 24);
        if (drumLit || stage.kind === "conveyors") spr(Math.floor(frames / 6) % 2 ? "flameA" : "flameB", stage.drum.x, stage.drum.y - 36);
      }
      for (const l of stage.ladders) drawLadder(l);
      if (plays <= 1 && state === "play" && !M.onLad && !M.air && frames % 16 < 12) {
        for (const l of stage.ladders) {
          if (l.broken || Math.abs(l.yBot - M.y) > 5) continue;
          const ax = l.x, ay = l.yBot - 20; fb.fillStyle = "#1ce8ff";
          fb.fillRect(ax - 1, ay, 2, 6); fb.fillRect(ax - 2, ay + 1, 4, 1); fb.fillRect(ax - 3, ay + 2, 6, 1);
        }
      }
      for (const p of stage.plats) { if (p.rivet) continue; drawGirder(p, tilt); }
      for (const rv of rivets) if (!rv.gone) spr("rivet", rv.x, rv.y);
      for (const e of stage.elevators) { fb.fillStyle = GIRDER; fb.fillRect(e.x, Math.round(e.y), 16, 6); fb.fillStyle = GDOT; fb.fillRect(e.x + 2, Math.round(e.y) + 2, 2, 2); fb.fillRect(e.x + 12, Math.round(e.y) + 2, 2, 2); }
      if (stage.stack) for (let i = 0; i < 3; i++) spr(i === 1 ? "blueSide" : "barrelSide", stage.stack.x, stage.stack.y - 10 - i * 10);
      for (const h of hammers) if (!h.taken) spr("hammer", h.x - 4, h.y);
      for (const it of items) if (!it.taken) spr(it.kind, it.x - 8, it.y - 8);
      // the ape and the lady
      if (state === "clear" && stage.kind !== "rivets" && stateT > 80) {
        spr("kongSide", kong.x + 4, kong.y - 16); spr("lady", lady.x - 7, lady.y - 22);
      } else if (state === "clear" && stage.kind === "rivets" && stateT > 60) {
        fb.save(); fb.translate(kong.x + 20, kong.y - 16); fb.rotate(Math.PI); fb.drawImage(SPR.kong, -20, -16); fb.restore();
      } else {
        drawKong(kong.x, kong.y, kong.mode, kong.frame);
      }
      if (!(state === "clear" && stage.kind !== "rivets" && stateT > 80)) spr(Math.floor(lady.t / 24) % 2 ? "ladyWave" : "lady", lady.x - 7, lady.y - 22);
      if ((state === "play" || state === "ready" || state === "intro") && Math.floor(frames / 30) % 2) text("HELP!", lady.x < 160 ? lady.x + 12 : lady.x - 54, lady.y - 30, "#1ce8ff");
      if (heart) { if (stage.kind === "rivets") spr("heart", (M.x + lady.x) / 2 - 5, Math.min(M.y, lady.y) - 34); else spr("heart", (M.x + lady.x) / 2 - 5, Math.min(M.y, lady.y) - 30); }
      // hazards
      for (const b of barrels) {
        const nm = b.wild || b.mode === "wild" ? (b.blue ? "blueSide" : "barrelSide") : (b.blue ? (b.spin >> 2) & 1 ? "blueA" : "blueB" : (b.spin >> 2) & 1 ? "barrelA" : "barrelB");
        spr(nm, b.x - (b.mode === "wild" ? 8 : 6), b.y - 10);
      }
      for (const p of pies) spr("pie", p.x - 8, p.y - 6);
      for (const s of springs) spr(s.frame ? "springB" : "springA", s.x - 8, s.y - 10);
      for (const f of fires) spr(M.hammer > 0 ? "fireBlue" : f.frame ? "fireA" : "fireB", f.x - 8, f.y - 16, f.dir < 0);
      drawPlayer();
      if (state === "play" && level === 1 && coachJumps < 3 && !M.air && !M.onLad && !M.hammer && Math.floor(frames / 6) % 2) {
        for (const b of barrels) {
          if (b.mode !== "roll" || Math.abs(b.y - M.y) > 6 || Math.sign(M.x - b.x) !== b.dir) continue;
          const dist = Math.abs(b.x - M.x); if (dist > 44 || dist < 12) continue;
          textC("JUMP!", M.x, M.y - 30, "#f8d820"); break;
        }
      }
      for (const p of pops) { const a = 1 - p.t / 50; fb.globalAlpha = a; textC(p.text, p.x, p.y - p.t * 0.3, "#ffffff"); fb.globalAlpha = 1; }
    }
    function drawPlayer() {
      if (state === "clear" && stage.kind !== "rivets" && stateT > 80) { spr("stand", M.x - 6, M.y - 16, false); return; }
      const flip = M.dir < 0;
      if (state === "dying") {
        const k = Math.floor(M.dead / 8) % 4;
        fb.save(); fb.translate(Math.round(M.x), Math.round(M.y - 8)); fb.rotate(k * Math.PI / 2); fb.drawImage(SPR[flip ? "stand_f" : "stand"], -6, -8); fb.restore();
        return;
      }
      if (state === "dead") { spr("stand", M.x - 6, M.y - 16, flip); spr("halo", M.x - 5, M.y - 23 - Math.floor(stateT / 10)); return; }
      if (M.onLad) {
        const nearTop = !M.onLad.broken && M.y < M.onLad.yTop + 7;
        if (nearTop) spr("climbTop", M.x - 6, M.y - 16 + (M.onLad.yTop + 7 - M.y) * 0.8);
        else spr("climbA", M.x - 6, M.y - 16, Math.floor(M.climbT / 8) % 2 === 1);
        return;
      }
      if (M.hammer > 0) {
        const blink = M.hammer < 120 && Math.floor(frames / 4) % 2;
        if (M.hamFrame === 0) { spr("hammerUp", M.x - 6, M.y - 16, flip); if (!blink) spr("hammer", M.x - 4, M.y - 27); }
        else { spr("hammerDown", M.x - 6, M.y - 16, flip); if (!blink) spr("hammerSide", flip ? M.x - 16 : M.x + 6, M.y - 13, flip); }
        return;
      }
      if (M.air) { spr("jump", M.x - 6, M.y - 16, flip); return; }
      spr(M.walkT > 0 && Math.floor(M.walkT / 8) % 2 ? "walk" : "stand", M.x - 6, M.y - 16, flip);
    }
    function pad6(n) { return String(Math.max(0, Math.floor(n))).padStart(6, "0"); }
    function drawHUD() {
      const flash = oneUpFlash > 0 && Math.floor(frames / 6) % 2;
      text("1UP", 24, 0, flash ? "#f8d820" : "#ffffff"); text("HIGH SCORE", 80, 0, "#ff4d8c");
      text(pad6(score), 8, 8, "#ffffff"); text(pad6(best), 96, 8, "#ffffff");
      for (let i = 0; i < Math.min(lives, 5); i++) spr("life", 8 + i * 10, 17);
      text("L=" + String(level).padStart(2, "0"), 176, 17, "#1ce8ff");
      fb.strokeStyle = "#2f52ff"; fb.lineWidth = 1; fb.strokeRect(166.5, 26.5, 52, 19);
      text("BONUS", 172, 28, "#1ce8ff"); text(String(bonus).padStart(4, " "), 176, 37, "#f8d820");
    }
    function textBig(s, x, y, color) {
      for (let i = 0; i < s.length; i++) if (s[i] !== " ") fb.drawImage(glyph(s[i], color), x + i * 16, y, 16, 16);
    }
    function drawTitle() {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      textBig("BARREL", 64, 34, "#f24a3c"); textBig("HEIGHTS", 56, 54, "#f8d820");
      // a little diorama
      const p = P(0, 224, 120, 120, "flat"); drawGirder(p, 1);
      const l = { x: 176, yTop: 120, yBot: 152, broken: 0 }; drawLadder(l); const p2 = P(96, 224, 152, 152, "flat"); drawGirder(p2, 1);
      drawKong(24, 120, "beat", Math.floor(frames / 16) % 2);
      spr(Math.floor(frames / 24) % 2 ? "ladyWave" : "lady", 92, 120 - 22);
      spr("stand", 140, 152 - 16, true);
      const bx = (frames * 1.1) % 100; spr((frames >> 2) & 1 ? "barrelA" : "barrelB", 200 - bx, 120 - 10);
      text("DRAG THE PAD TO WALK", 32, 172, "#ffffff"); text("AND CLIMB. TAP TO JUMP.", 24, 182, "#ffffff");
      text("JUMP THE BARRELS, GRAB", 24, 198, "#ffffff"); text("THE HAMMER, PULL THE", 32, 208, "#ffffff"); text("RIVETS, SAVE THE LADY.", 24, 218, "#ffffff");
      text("HIGH SCORE " + pad6(best), 24, 232, "#1ce8ff");
      if (Math.floor(frames / 25) % 2) textC("TAP TO START", 112, 246, "#f8d820");
    }
    function drawHowHigh() {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      textC("HOW HIGH CAN YOU GET?", 112, 10, "#1ce8ff");
      const n = Math.min(6, (level - 1) * 4 + stageIdx + 1);
      for (let k = 0; k < n; k++) {
        const y = 234 - k * 36;
        const p = P(40, 128, y, y, "flat"); drawGirder(p, 1);
        drawKong(44, y, "beat", (Math.floor(frames / 16) + k) % 2);
        text((k + 1) * 25 + "m", 136, y - 20, "#f8d820");
      }
      textC("LEVEL " + level + "  " + STAGE_M[stageIdx] + "m", 112, 246, "#ffffff");
    }
    function drawGameOver() {
      fb.fillStyle = "#000"; fb.fillRect(56, 102, 112, 50); fb.strokeStyle = "#2f52ff"; fb.strokeRect(56.5, 102.5, 111, 49);
      textC("GAME OVER", 112, 110, "#ff4d8c"); textC(pad6(score), 112, 124, "#ffffff");
      if (score >= best && score > 0) textC("NEW BEST!", 112, 138, "#f8d820");
    }
    function drawHowTo() {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      textC("HOW TO PLAY", 112, 14, "#f8d820");
      const rows = [
        ["walk", "PAD LEFT/RIGHT WALKS", "PUSH UP AT A LADDER"],
        ["barrel", "TAP JUMP TO HOP A", "BARREL. 100 POINTS"],
        ["ladder", "A BROKEN LADDER IS", "A SAFE PERCH"],
        ["hammer", "JUMP INTO A HAMMER", "TO SMASH BARRELS"],
        ["fall", "NEVER WALK OFF THE", "END OF A GIRDER"],
        ["lady", "REACH THE LADY BEFORE", "THE BONUS RUNS OUT"]];
      rows.forEach((r, i) => {
        const y = 34 + i * 34;
        if (r[0] === "walk") { spr("walk", 14, y + 2, false); }
        if (r[0] === "barrel") { spr("jump", 8, y - 6, false); spr("barrelA", 22, y + 8); }
        if (r[0] === "ladder") { const l = { x: 20, yTop: y - 4, yBot: y + 20, broken: 10 }; drawLadder(l); spr("climbA", 14, y + 4, false); }
        if (r[0] === "hammer") { spr("hammerUp", 14, y + 4, false); spr("hammer", 16, y - 7); }
        if (r[0] === "fall") { const p = P(4, 30, y + 18, y + 18, "flat"); drawGirder(p, 1); spr("stand", 20, y + 2, false); }
        if (r[0] === "lady") { spr("lady", 13, y - 2); }
        text(r[1], 44, y + 2, "#ffffff"); text(r[2], 44, y + 12, "#ffffff");
      });
      if (Math.floor(frames / 25) % 2) textC("TAP TO CONTINUE", 112, 244, "#f8d820");
    }
    function drawFrame() {
      if (state === "title") drawTitle();
      else if (state === "howto") drawHowTo();
      else if (state === "howhigh") drawHowHigh();
      else {
        const tilt = state === "intro" ? clamp(Math.floor((stateT - 10) / 30) / 4, 0, 1) : 1;
        drawStage(tilt); drawHUD();
        if (state === "ready" && Math.floor(stateT / 8) % 2) textC("READY", 112, 130, "#f8d820");
        if ((state === "dead" || (state === "ready" && lastCause)) && TIPS[lastCause] && tipsShown <= 8) {
          fb.fillStyle = "#000"; fb.fillRect(8, 150, 208, 34); fb.strokeStyle = "#1ce8ff"; fb.strokeRect(8.5, 150.5, 207, 33);
          textC("TIP", 112, 153, "#1ce8ff"); textC(TIPS[lastCause][0], 112, 163, "#ffffff"); textC(TIPS[lastCause][1], 112, 173, "#ffffff");
        }
        if (state === "gameover") drawGameOver();
      }
    }

    // ---- layout + presentation --------------------------------------------------------
    const dpr = ctx.dpr || 1;
    let W = ctx.width, Hh = ctx.height, S = 1, ox = 0, oy = 0, fieldBottom = 0, padC = { x: 0, y: 0, r: 60 }, jumpC = { x: 0, y: 0, r: 46 };
    function layout() {
      W = ctx.width; Hh = ctx.height;
      const ctrlH = Math.max(150, Math.min(230, Hh * 0.26));
      const availH = Hh - sa.top - sa.bottom - ctrlH - 8;
      S = Math.max(1, Math.floor(Math.min(canvas.width / FW, availH * dpr / FH)));
      ox = Math.floor((canvas.width - FW * S) / 2); oy = Math.floor((sa.top + 4) * dpr);
      fieldBottom = oy / dpr + FH * S / dpr;
      const top = fieldBottom + 6, bot = Hh - sa.bottom - 6, cy = (top + bot) / 2;
      const r = clamp((bot - top) / 2 - 4, 40, 74);
      padC = { x: clamp(W * 0.26, r + 10, W / 2 - r - 6), y: cy, r };
      jumpC = { x: W - clamp(W * 0.22, r * 0.85 + 10, W / 2), y: cy, r: r * 0.8 };
    }
    layout();
    function drawControls() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const on = "rgba(255,255,255,0.9)", off = "rgba(255,255,255,0.28)";
      g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,0.22)";
      g.beginPath(); g.arc(padC.x, padC.y, padC.r, 0, Math.PI * 2); g.stroke();
      const arrows = [["left", -1, 0, inp.left], ["right", 1, 0, inp.right], ["up", 0, -1, inp.up], ["down", 0, 1, inp.down]];
      for (const [, dx, dy, act] of arrows) {
        const ax = padC.x + dx * padC.r * 0.62, ay = padC.y + dy * padC.r * 0.62, sz = padC.r * 0.22;
        g.fillStyle = act ? on : off; g.beginPath();
        g.moveTo(ax + dx * sz, ay + dy * sz); g.lineTo(ax - dx * sz * 0.6 + dy * sz, ay - dy * sz * 0.6 + dx * sz); g.lineTo(ax - dx * sz * 0.6 - dy * sz, ay - dy * sz * 0.6 - dx * sz);
        g.closePath(); g.fill();
      }
      g.fillStyle = inp.jump ? "rgba(242,74,60,0.85)" : "rgba(242,74,60,0.35)"; g.beginPath(); g.arc(jumpC.x, jumpC.y, jumpC.r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.35)"; g.stroke();
      g.fillStyle = "#fff"; g.font = "700 " + Math.round(jumpC.r * 0.36) + "px ui-monospace,Menlo,Consolas,monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("JUMP", jumpC.x, jumpC.y);
      // mute
      g.font = "16px ui-monospace,Menlo,Consolas,monospace"; g.fillStyle = "rgba(255,255,255,0.7)"; g.textAlign = "right"; g.fillText(muted ? "🔇" : "🔊", W - sa.right - 12, sa.top + 18);
    }
    function present() {
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.imageSmoothingEnabled = false;
      const sx = shake ? Math.round(rnd(-shake, shake) * S * 0.5) : 0, sy = shake ? Math.round(rnd(-shake, shake) * S * 0.5) : 0;
      g.drawImage(fbc, ox + sx, oy + sy, FW * S, FH * S);
      drawControls();
    }

    // ---- input ----------------------------------------------------------------------------
    const pointers = new Map();
    function padDir(px, py) {   // a diagonal push walks and climbs at once
      const dx = px - padC.x, dy = py - padC.y;
      if (Math.hypot(dx, dy) < 9) return null;
      const out = {};
      if (Math.abs(dx) > Math.abs(dy) * 0.6) out.h = dx < 0 ? "left" : "right";
      if (Math.abs(dy) > Math.abs(dx) * 0.6) out.v = dy < 0 ? "up" : "down";
      return out;
    }
    function recomputeInput() {
      inp.left = inp.right = inp.up = inp.down = false; let jumpHeld = false;
      for (const p of pointers.values()) {
        if (p.zone === "pad" && p.dir) { if (p.dir.h) inp[p.dir.h] = true; if (p.dir.v) inp[p.dir.v] = true; }
        if (p.zone === "jump") jumpHeld = true;
      }
      for (const k of keys) { if (k === "left" || k === "right" || k === "up" || k === "down") inp[k] = true; if (k === "jump") jumpHeld = true; }
      inp.jump = jumpHeld;
    }
    const keys = new Set();
    function pressJump() { inp.jumpBuf = 8; }
    function anyStart() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      ensureAC(); resumeAC();
      if (state === "title") { startGame(); return true; }
      if (state === "howto" && stateT > 20) { state = "intro"; stateT = 0; sfx.start(); return true; }
      if (state === "gameover" && stateT > 40) { state = "title"; stateT = 0; return true; }
      if (state === "intro" && stateT > 30) { state = "howhigh"; stateT = 0; sfx.howHigh(); return true; }
      if (state === "howhigh" && stateT > 30) { beginStage(); return true; }
      return false;
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      const x = e.clientX, y = e.clientY;
      if (x > W - sa.right - 44 && y < sa.top + 34) { muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); return; }
      if (anyStart()) return;
      if (y < fieldBottom) { pressJump(); pointers.set(e.pointerId, { zone: "jump" }); }
      else if (x < W / 2) pointers.set(e.pointerId, { zone: "pad", dir: padDir(x, y) });
      else { pressJump(); pointers.set(e.pointerId, { zone: "jump" }); }
      recomputeInput();
    });
    ctx.listen(canvas, "pointermove", (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      if (p.zone === "pad") { p.dir = padDir(e.clientX, e.clientY); recomputeInput(); }
    });
    const up = (e) => { if (pointers.delete(e.pointerId)) recomputeInput(); };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);
    const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", Space: "jump", KeyZ: "jump", KeyX: "jump", Enter: "start" };
    ctx.listen(document, "keydown", (e) => {
      const k = KEYMAP[e.code]; if (!k) return; e.preventDefault();
      if (k === "start") { anyStart(); return; }
      if (k === "jump") { if (!keys.has("jump")) { if (!anyStart()) pressJump(); } }
      keys.add(k); recomputeInput();
    });
    ctx.listen(document, "keyup", (e) => { const k = KEYMAP[e.code]; if (!k) return; keys.delete(k); recomputeInput(); });

    // ---- main loop --------------------------------------------------------------------------
    let acc = 0, last = ctx.width + "x" + ctx.height;
    ctx.onFrame((dtMs) => {
      const now = ctx.width + "x" + ctx.height; if (now !== last) { last = now; layout(); }
      acc += Math.min(dtMs, 100);
      let n = 0; while (acc >= 1000 / 60 && n < 6) { acc -= 1000 / 60; tick(); n++; }
      if (n === 6) acc = 0;
      drawFrame(); present();
    });

    // debug hooks for the headless harness
    window.__bhInfo = () => ({ state, stateT, level, stage: stage && stage.kind, score, lives, bonus, mx: Math.round(M.x), my: Math.round(M.y), air: M.air, lad: !!M.onLad, hammer: M.hammer, barrels: barrels.length, fires: fires.length, pies: pies.length, springs: springs.length, elev: stage ? stage.elevators.map((e) => Math.round(e.y)) : [], rivets: rivets.filter((r) => !r.gone).length, onElev: !!M.onElev, kongY: Math.round(kong.y), bx: barrels.map((b) => Math.round(b.x)), S, W, Hh });
    window.__bhStart = () => { anyStart(); };
    window.__bhSkip = () => { if (state === "intro" || state === "howhigh") { beginStage(); } if (state === "ready") { state = "play"; stateT = 0; } };
    window.__bhKey = (k, on) => { if (on) keys.add(k); else keys.delete(k); recomputeInput(); };
    window.__bhJump = () => pressJump();
    window.__bhWarp = (x, y) => { M.x = x; M.y = y; M.air = false; M.onLad = null; M.plat = platAt(x, y, 4); M.fallFrom = y; };
    window.__bhStage = (i) => { stageIdx = i; loadStage(); state = "play"; stateT = 0; };
    window.__bhSpawn = (kind) => { if (kind === "barrel") spawnBarrel(false, false); if (kind === "blue") spawnBarrel(true, false); if (kind === "fire") spawnFire(M.x + 40, M.y, M.plat); if (kind === "spring") spawnSpring(); if (kind === "pie") spawnPie(stage.plats[10]); };
    window.__bhHammer = () => { M.hammer = 500; };
    window.__bhDie = () => die("debug");
    window.__bhStep = (n) => { for (let i = 0; i < n; i++) tick(); };
    window.__bhBarrelAt = (x, dir) => { const p = platAt(x, M.y, 6) || stage.plats[0]; barrels.push({ x, y: surf(p, x), dir, blue: false, wild: false, plat: p, mode: "roll", vy: 0, vx: 0, spin: 0, passed: false, speed: 1.25 + 0.08 * (diff() - 1) }); };
    window.__bhReset = () => { barrels = []; fires = []; state = "play"; stateT = 0; M.hammer = 0; resetPlayer(); };
    window.__bhClear = () => { state = "clear"; stateT = 0; clearPhase = 0; heart = 0; };

    drawFrame(); present();
    try { ctx.markVisualReady("title"); } catch (_) {}
    ctx.platform.ready();
  }
};
