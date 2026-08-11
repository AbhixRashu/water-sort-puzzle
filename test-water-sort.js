const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('No <script> block found'); process.exit(1); }
const code = m[1];
const mod = new Function(code + '; return { GameEngine, generateLevel, solve, validPuzzle, difficultyForLevel, CFG, sanitizeSave, selfTest, themeForLevel, shapeForLevel, bottleCountForLevel, THEMES, SHAPES, heuristicMove, xpForLevel, playerLevelFromXp, gainXp, dateKey, addDays, touchDailyStreak, EXP_RATES };')();

let failures = 0;
let warnings = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}
function warn(msg) { warnings++; console.warn('WARN: ' + msg); }

console.log('Running logic tests...');

// Built-in self-test (logs ALL TESTS PASSED itself)
try {
  mod.selfTest();
  console.log('selfTest() -> OK');
} catch (e) {
  failures++;
  console.error('FAIL: selfTest threw: ' + e.message);
}

// Full 200-level sweep against the game API (skipHeavy keeps it fast)
for (let level = 1; level <= 200; level++) {
  const gen = mod.generateLevel(level, { skipHeavy: true });
  check(gen.tubes.length > 0, 'level ' + level + ' generated empty');
  check(gen.tubes.length === mod.bottleCountForLevel(level), 'level ' + level + ' wrong tube count');
  check(gen.tubes.every(t => t.length <= 4), 'level ' + level + ' tube over capacity');
  check(gen.tubes.every(t => t.every(c => c >= 0 && c < gen.colors)), 'level ' + level + ' color out of range');
  const total = gen.tubes.reduce((s, t) => s + t.length, 0);
  check(total === gen.colors * 4, 'level ' + level + ' wrong total units: ' + total);
  check(gen.solution.length > 0, 'level ' + level + ' missing solution');

  let st = gen.tubes, ok = true;
  for (const [s, d] of gen.solution) {
    if (!mod.GameEngine.canPour(st, s, d)) { ok = false; break; }
    st = mod.GameEngine.pour(st, s, d);
  }
  check(ok, 'level ' + level + ' solution contained an illegal move');
  check(mod.GameEngine.isSolved(st), 'level ' + level + ' solution did not reach solved');
  check(mod.GameEngine.hasLegalMove(gen.tubes), 'level ' + level + ' deadlock (no legal move)');

  const again = mod.generateLevel(level, { skipHeavy: true });
  check(JSON.stringify(gen.tubes) === JSON.stringify(again.tubes), 'level ' + level + ' not deterministic');

  check(mod.THEMES.includes(mod.themeForLevel(level)), 'level ' + level + ' bad theme');
  check(mod.SHAPES.includes(mod.shapeForLevel(level)), 'level ' + level + ' bad shape');
}

// Bottle count must ramp up with level (never decrease)
{
  let prev = 0;
  for (let level = 1; level <= 200; level++) {
    const c = mod.bottleCountForLevel(level);
    check(c >= 4 && c <= 20, 'level ' + level + ' bottle count out of range');
    check(c >= prev, 'level ' + level + ' bottle count decreased');
    prev = c;
  }
  console.log('Bottle count L1/L25/L50/L121/L200:', mod.bottleCountForLevel(1), mod.bottleCountForLevel(25), mod.bottleCountForLevel(50), mod.bottleCountForLevel(121), mod.bottleCountForLevel(200));
}

// Heavy (validated) generation + BFS checks on the easy tiers
for (let level = 1; level <= 10; level++) {
  const gen = mod.generateLevel(level);
  check(mod.validPuzzle(gen.tubes, level), 'level ' + level + ' failed validPuzzle');
  const path = mod.solve(gen.tubes, { wantPath: true, maxNodes: 200000, maxMs: 3000 });
  check(!!path, 'level ' + level + ' BFS found no solution');
  if (path) {
    let st = gen.tubes, ok = true;
    for (const [s, d] of path) { if (!mod.GameEngine.canPour(st, s, d)) { ok = false; break; } st = mod.GameEngine.pour(st, s, d); }
    check(ok && mod.GameEngine.isSolved(st), 'level ' + level + ' BFS path invalid');
    check(path.length >= 3, 'level ' + level + ' too trivial: depth ' + path.length);
  }
}

// Sanitize (corrupt-data) handling
check(mod.sanitizeSave(null).unlocked === 1, 'sanitize(null)');
check(mod.sanitizeSave({ unlocked: 999 }).unlocked === 200, 'sanitize clamp high');
check(mod.sanitizeSave({ unlocked: 0 }).unlocked === 1, 'sanitize clamp low');
check(Array.isArray(mod.sanitizeSave({ done: 'garbage' }).done), 'sanitize done array');
check(typeof mod.sanitizeSave({ best: 'garbage' }).best === 'object', 'sanitize best object');
check(mod.sanitizeSave({ done: [0, 5, 201, -3] }).done.length === 1, 'sanitize done filtering');

// EXP / player-level math
check(mod.playerLevelFromXp(0).level === 1, 'xp level starts at 1');
check(mod.playerLevelFromXp(0).need === 100, 'first xp tier is 100');
check(mod.playerLevelFromXp(99).level === 1, 'xp 99 stays level 1');
check(mod.playerLevelFromXp(100).level === 2, 'xp 100 reaches level 2');
check(mod.playerLevelFromXp(230).into === 130, 'xp carry-over into next tier');
check(mod.xpForLevel(1) === 100 && mod.xpForLevel(3) === 180, 'xp tier growth');
check(mod.gainXp(25).after >= mod.gainXp(25).before, 'gainXp never delevels');
check(mod.EXP_RATES.base > 0, 'exp base rate positive');

// Daily-streak date math
check(mod.dateKey(new Date(2026, 0, 5)) === '2026-01-05', 'dateKey format');
check(mod.addDays(new Date(2026, 0, 5), 1).getDate() === 6, 'addDays forward');
check(mod.addDays(new Date(2026, 0, 5), -1).getDate() === 4, 'addDays backward');

// Immutability: pour must never mutate input
const input = mod.GameEngine.freeze([[0, 0, 1], [1, 0], [], []]);
const before = JSON.stringify(input);
mod.GameEngine.pour(input, 0, 2);
check(JSON.stringify(input) === before, 'pour mutated frozen input');
const applied = mod.GameEngine.pour(input, 0, 2);
check(applied !== input, 'pour returned same reference');
check(applied[0].length === 2, 'pour result source length');
check(applied[2][0] === 1, 'pour result target content');

// Overflow regression: a 3-cube tube must reject a 2-cube matching run
const over = mod.GameEngine.freeze([[1, 1, 0, 0], [1, 1, 1], []]);
check(!mod.GameEngine.canPour(over, 0, 1), 'overflow pour (3+2) must be illegal');
const over2 = mod.GameEngine.freeze([[0, 0, 0], [0, 0, 0, 0], []]);
check(!mod.GameEngine.canPour(over2, 0, 1), 'pour into full tube must be illegal');
const fit = mod.GameEngine.freeze([[0, 1], [1, 1, 1], []]);
check(mod.GameEngine.canPour(fit, 0, 1), 'exact-fit pour (3+1) must be legal');
const p = mod.GameEngine.pour(fit, 0, 1);
check(p && p[1].length === 4, 'exact-fit pour result should be 4 cubes');
check(p && p[1].every(c => c === 1), 'exact-fit pour keeps tube uniform');

// Every level must never produce a tube over capacity from a legal move
for (const level of [1, 10, 50, 100, 150, 200]) {
  const tubes = mod.generateLevel(level, { skipHeavy: true }).tubes;
  for (let s = 0; s < tubes.length; s++) {
    for (let d = 0; d < tubes.length; d++) {
      const after = mod.GameEngine.pour(tubes, s, d);
      if (after) check(after.every(t => t.length <= 4), 'level ' + level + ' legal pour overflowed capacity');
    }
  }
}

// Heuristic always returns a legal move when one exists
for (const level of [50, 100, 150, 200]) {
  const tubes = mod.generateLevel(level, { skipHeavy: true }).tubes;
  const mv = mod.heuristicMove(tubes);
  check(!!mv, 'heuristicMove no move for level ' + level);
  if (mv) check(mod.GameEngine.canPour(tubes, mv[0], mv[1]), 'heuristic move illegal for level ' + level);
}

const counts = {};
for (let level = 1; level <= 200; level++) {
  const c = mod.difficultyForLevel(level).colors;
  counts[c] = (counts[c] || 0) + 1;
}
console.log('Color distribution:', counts);
console.log('Level 1:', JSON.stringify(mod.difficultyForLevel(1)), '| Level 200:', JSON.stringify(mod.difficultyForLevel(200)));

if (failures === 0) {
  console.log('ALL TESTS PASSED (' + 200 + ' levels + BFS + sanitize + immutability + heuristics)' + (warnings ? ' with ' + warnings + ' warning(s)' : ''));
} else {
  console.error(failures + ' test(s) FAILED');
  process.exit(1);
}
