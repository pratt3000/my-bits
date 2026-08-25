/*
 * Exercises the derby's physics directly, lifted out of main.js between its
 * markers. Physics bugs are invisible in a screenshot and obvious in numbers.
 */
import { readFileSync } from "node:fs";
const src = readFileSync("/home/user/my-bits/helmet-derby/main.js", "utf8");
const body = src.split("/* ===== PHYSICS START ===== */")[1].split("/* ===== PHYSICS END ===== */")[0];
const boot = `
  const L = { scale: 1, floor: 600, wallL: 10, wallR: 380, top: 50 };
  const clamp = (v,a,b) => (v<a?a:v>b?b:v);
  const TAU = Math.PI * 2;
  ${body}
  return { makeCar, discs, step, bonk, GRAV, L };`;
const R = new Function(boot)();

let fails = 0;
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) fails++; };
const ground = [{ x: 10, y: 600, w: 370, h: 40 }];
const run = (cars, n, dt = 1 / 120) => { for (let i = 0; i < n; i++) R.step(cars, ground, dt); };

// --- a dropped car comes to rest ON the ground, not through it ---
let c = R.makeCar(0, 200, 300);
run([c], 600);
check(c.y < 600 && c.y > 540, "a dropped car rests on the ground, not through it (y=" + Math.round(c.y) + ")");
check(Math.abs(c.vy) < 60, "and it has stopped falling (vy=" + Math.round(c.vy) + ")");

// --- a fast car does not tunnel through a slab ---
c = R.makeCar(0, 200, 200);
c.vy = 6000;                                  // absurd, far faster than play
run([c], 240);
check(c.y < 620, "a car at 6000px/s does not tunnel through the floor (y=" + Math.round(c.y) + ")");

// --- driving on the ground actually moves you ---
c = R.makeCar(0, 200, 560);
run([c], 200);
const x0 = c.x;
console.log("       settled angle:", c.a.toFixed(3), "rad | av:", c.av.toFixed(3), "| grounded:", c.grounded);
c.drive = 1;
run([c], 200);
console.log("       after driving: angle", c.a.toFixed(3), "| x moved", Math.round(c.x - x0));
check(c.x > x0 + 8, "holding forward drives the car along the ground (moved " + Math.round(c.x - x0) + "px)");

// --- in the air the same input spins rather than thrusts ---
c = R.makeCar(0, 200, 200);
c.drive = 1;
const a0 = c.a;
run([c], 60);
check(Math.abs(c.a - a0) > 0.15, "in the air the same input spins the car (turned " + (c.a - a0).toFixed(2) + " rad)");

// --- the walls hold ---
c = R.makeCar(0, 200, 560);
c.vx = -4000;
run([c], 200);
check(c.x > 10, "a car cannot be driven through the left wall (x=" + Math.round(c.x) + ")");

// --- the bonk test is the win condition, so it has to be exact ---
let a = R.makeCar(0, 200, 500), b = R.makeCar(1, 260, 500);
check(R.bonk([a, b]) === null, "two cars side by side is not a bonk");
a.x = b.x; a.y = b.y - b.helmetUp - 2;        // sitting on b's head
check(R.bonk([a, b]) === 0, "landing on a helmet scores for the lander");
a = R.makeCar(0, 200, 500); b = R.makeCar(1, 200, 500);
b.a = Math.PI;
check(R.bonk([a, b]) === "draw" || R.bonk([a, b]) !== null,
      "two cars in the same place resolve to a result, not to nothing");

console.log(fails ? "\n" + fails + " FAILED" : "\nall physics checks passed");
process.exit(fails ? 1 : 0);
