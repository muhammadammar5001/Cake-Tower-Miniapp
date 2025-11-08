import React, { useEffect, useRef, useState, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, push, set, onValue, query, limitToFirst } from "firebase/database";

/* =====================
   CONFIG: Firebase (optional)
   - If you want a real shared leaderboard, create a Firebase Realtime Database
     and paste your credentials below (replace the placeholders).
   - If left empty or invalid, the app falls back to localStorage leaderboard.
   ===================== */
const FIREBASE_CONFIG = {
  apiKey: "", // <-- paste your firebase values here if you want real shared leaderboard
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

/* backgrounds and cake styles */
const BACKGROUNDS = [
  "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1200&q=80",
  "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&q=80",
  "https://images.unsplash.com/photo-1557683316-973673baf926?w=1200&q=80",
  "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80",
  "https://images.unsplash.com/photo-1573920111312-04f1b25c6b85?w=1200&q=80"
];

const CAKE_STYLES = [
  { base: "#FF1493", frosting: "#FFB6D9", cream: "#FFFFFF", sprinkles: ["#FFD700", "#00CED1", "#FF6347"], height: 38 },
  { base: "#9370DB", frosting: "#E0CCFF", cream: "#F0E6FF", sprinkles: ["#FFD700", "#FF69B4", "#00CED1"], height: 36 },
  { base: "#FFD700", frosting: "#FFF9E6", cream: "#FFFFFF", sprinkles: ["#FF1493", "#9370DB", "#FF6347"], height: 40 },
  { base: "#FF6347", frosting: "#FFD4C1", cream: "#FFE6E0", sprinkles: ["#FFD700", "#00CED1", "#FF69B4"], height: 35 },
  { base: "#48D1CC", frosting: "#C1F0ED", cream: "#E0FFFF", sprinkles: ["#FFD700", "#FF1493", "#9370DB"], height: 37 },
  { base: "#FF69B4", frosting: "#FFD6E8", cream: "#FFF0F5", sprinkles: ["#FFD700", "#9370DB", "#00CED1"], height: 39 }
];

const LOCAL_LEADERBOARD_KEY = "cake_tower_leaderboard_v1";
const LOCAL_HIGHSCORE_KEY = "cake_tower_highscore_v1";
const LOCAL_NAME_KEY = "cake_tower_playername_v1";

/* ---------------------------
   Helper: Firebase init if configured
   --------------------------- */
let firebaseDb = null;
if (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey) {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    firebaseDb = getDatabase(app);
    console.log("Firebase initialized");
  } catch (e) {
    console.warn("Firebase init failed, falling back to local storage", e);
    firebaseDb = null;
  }
}

/* ---------------------------
   App component
   --------------------------- */
export default function App() {
  // UI
  const [playerName, setPlayerName] = useState(localStorage.getItem(LOCAL_NAME_KEY) || "");
  const [bgIndex, setBgIndex] = useState(Math.floor(Math.random() * BACKGROUNDS.length));

  // Game state
  const [gameState, setGameState] = useState("menu"); // menu | playing | gameover
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(parseInt(localStorage.getItem(LOCAL_HIGHSCORE_KEY) || "0", 10));
  const [combo, setCombo] = useState(0);

  // canvas dims
  const containerRef = useRef(null);
  const [canvasW, setCanvasW] = useState(360);
  const [canvasH, setCanvasH] = useState(560);

  // stack & moving piece
  const initialCakeWidth = 180;
  const [cakeStack, setCakeStack] = useState([]); // {x,width,style}
  const [movingCake, setMovingCake] = useState(null); // {x,width,style}
  const [speed, setSpeed] = useState(3);
  const [direction, setDirection] = useState(1);

  // physics pieces falling
  const [fallingPieces, setFallingPieces] = useState([]);

  // animation
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);

  // leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  const [useFirebase, setUseFirebase] = useState(!!firebaseDb);

  // responsive sizing
  useEffect(() => {
    const resize = () => {
      const w = containerRef.current ? containerRef.current.clientWidth : window.innerWidth;
      const width = Math.min(500, Math.max(300, Math.floor(w * 0.9)));
      setCanvasW(width);
      setCanvasH(Math.floor(width * 1.45));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // save name and highscore
  useEffect(() => {
    if (playerName) localStorage.setItem(LOCAL_NAME_KEY, playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem(LOCAL_HIGHSCORE_KEY, String(highScore || 0));
  }, [highScore]);

  // read leaderboard: firebase if configured else localStorage
  useEffect(() => {
    async function loadLB() {
      if (useFirebase && firebaseDb) {
        try {
          const ref = dbRef(firebaseDb, "leaderboard");
          onValue(ref, snapshot => {
            const val = snapshot.val();
            if (!val) {
              setLeaderboard([]);
              return;
            }
            // firebase stores as pushed objects
            const arr = Object.values(val).sort((a,b)=>b.score-a.score).slice(0,100);
            setLeaderboard(arr);
          });
        } catch (e) {
          console.warn("Firebase read failed, using localStorage fallback", e);
          setUseFirebase(false);
        }
      } else {
        const raw = localStorage.getItem(LOCAL_LEADERBOARD_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setLeaderboard(Array.isArray(parsed) ? parsed.sort((a,b)=>b.score-a.score).slice(0,100) : []);
          } catch (e) {
            setLeaderboard([]);
          }
        }
      }
    }
    loadLB();
  }, [useFirebase]);

  /* ========== GAME LOOP (rAF) ========== */
  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = 0;
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    const step = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      // moving cake movement
      setMovingCake(prev => {
        if (!prev) return prev;
        const pxPerMs = speed / 16;
        let nx = prev.x + direction * pxPerMs * dt;
        let nd = direction;
        if (nx <= 0) { nx = 0; nd = 1; }
        if (nx + prev.width >= canvasW) { nx = Math.max(0, canvasW - prev.width); nd = -1; }
        setDirection(nd);
        return { ...prev, x: nx };
      });

      // falling pieces physics
      setFallingPieces(prev => {
        if (!prev || prev.length === 0) return prev;
        const updated = prev.map(p => {
          const vy = (p.vy || 0) + 0.8 * (dt / 16);
          return {
            ...p,
            vy,
            x: p.x + (p.vx || 0) * (dt / 16),
            y: p.y + vy * (dt / 16),
            rot: (p.rot || 0) + (p.rotSpeed || 0) * (dt / 16)
          };
        }).filter(p => p.y < canvasH + 300);
        return updated;
      });

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [canvasW, canvasH, direction, speed, stopLoop]);

  useEffect(() => {
    return () => stopLoop();
  }, [stopLoop]);

  /* ========== START / RESET ========== */
  const prepareBase = useCallback(() => {
    const startX = Math.floor((canvasW - initialCakeWidth) / 2);
    setCakeStack([{ x: startX, width: initialCakeWidth, style: CAKE_STYLES[0] }]);
  }, [canvasW]);

  const startGame = useCallback(() => {
    if (!playerName || !playerName.trim()) {
      alert("Enter your name to start (required for leaderboard).");
      return;
    }
    setScore(0);
    setCombo(0);
    setFallingPieces([]);
    prepareBase();
    const startX = Math.random() > 0.5 ? 0 : Math.max(0, canvasW - initialCakeWidth);
    setMovingCake({ x: startX, width: initialCakeWidth, style: CAKE_STYLES[Math.floor(Math.random()*CAKE_STYLES.length)] });
    setSpeed(3);
    setDirection(startX === 0 ? 1 : -1);
    setGameState("playing");
    startLoop();
  }, [canvasW, prepareBase, startLoop, playerName]);

  /* ========== STACK ACTION (player taps/clicks/SPACE) ========== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const onStack = useCallback(() => {
    if (gameState !== "playing" || !movingCake || cakeStack.length === 0) return;

    const top = cakeStack[cakeStack.length - 1];
    const mL = movingCake.x;
    const mR = movingCake.x + movingCake.width;
    const tL = top.x;
    const tR = top.x + top.width;

    const leftOverlap = Math.max(mL, tL);
    const rightOverlap = Math.min(mR, tR);
    const rawOverlap = rightOverlap - leftOverlap;
    const overlap = Math.max(0, Math.round(rawOverlap));

    // Miss?
    if (overlap <= 0) {
      // falling piece is whole moving cake
      const totalHeight = cakeStack.reduce((s,c)=>s+c.style.height, 0);
      setFallingPieces([{
        x: movingCake.x,
        y: canvasH - totalHeight - 40,
        width: movingCake.width,
        style: movingCake.style,
        vy: 0,
        vx: (Math.random()-0.5)*6,
        rot: 0,
        rotSpeed: (Math.random()-0.5)*20
      }]);
      // stop
      stopLoop();
      setGameState("gameover");
      // update scoreboard
      if (score > highScore) setHighScore(score);
      return;
    }

    // Perfect threshold
    const perfectThreshold = Math.max(3, Math.floor(movingCake.width * 0.05));
    const isPerfect = Math.abs(mL - tL) <= perfectThreshold && Math.abs(mR - tR) <= perfectThreshold;
    const newCombo = isPerfect ? combo + 1 : 0;
    setCombo(newCombo);

    // Falling pieces on left/right
    const pieces = [];
    const baseY = canvasH - cakeStack.reduce((s,c)=>s + c.style.height, 0) - 40;
    if (mL < tL) {
      pieces.push({
        x: mL, y: baseY,
        width: tL - mL,
        style: movingCake.style,
        vy: -2, vx: -4, rot: 0, rotSpeed: -12
      });
    }
    if (mR > tR) {
      pieces.push({
        x: tR, y: baseY,
        width: mR - tR,
        style: movingCake.style,
        vy: -2, vx: 4, rot: 0, rotSpeed: 12
      });
    }
    if (pieces.length) setFallingPieces(prev=>[...prev, ...pieces]);

    // add new cake slice
    const nextStyle = CAKE_STYLES[Math.floor(Math.random()*CAKE_STYLES.length)];
    const newCake = { x: leftOverlap, width: overlap, style: nextStyle };
    setCakeStack(prev => {
      const arr = [...prev, newCake];
      // keep manageable history
      if (arr.length > 120) arr.splice(0, arr.length - 120);
      return arr;
    });

    // update score
    const pts = 10 + (newCombo * 5) + (isPerfect ? 20 : 0);
    const newScore = score + pts;
    setScore(newScore);
    if (newScore > highScore) setHighScore(newScore);

    // speed up occasionally
    if ((cakeStack.length % 2) === 0) setSpeed(s => Math.min(8, s + 0.5));

    // new moving cake with width = overlap
    const startX = Math.random() > 0.5 ? 0 : Math.max(0, canvasW - overlap);
    setMovingCake({ x: startX, width: overlap, style: CAKE_STYLES[(cakeStack.length + 1) % CAKE_STYLES.length] });
    setDirection(startX === 0 ? 1 : -1);
  }, [cakeStack, canvasH, canvasW, combo, gameState, highScore, movingCake, score, stopLoop]);

  // keyboard / click binding
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (gameState === "playing") onStack();
        else if (gameState === "menu") startGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gameState, onStack, startGame]);

  // share function
  const share = useCallback(() => {
    const text = `🎂 ${playerName || "Player"} scored ${score} in Cake Tower! Can you beat me?`;
    if (navigator.share) {
      navigator.share({ title: "Cake Tower", text }).catch(()=>{/*ignore*/});
    } else {
      navigator.clipboard.writeText(text).then(()=>alert("Score copied to clipboard")).catch(()=>alert(text));
    }
  }, [playerName, score]);

  // submit to leaderboard (firebase if available else local)
  const submitLeaderboard = async () => {
    const final = score;
    if (!playerName || !playerName.trim()) { alert("Enter a name before submitting"); return; }
    if (useFirebase && firebaseDb) {
      try {
        const listRef = dbRef(firebaseDb, "leaderboard");
        const newRef = push(listRef);
        await set(newRef, { name: playerName.trim(), score: final, timestamp: Date.now() });
        alert("Submitted to global leaderboard ✅");
        return;
      } catch (e) {
        console.warn("Firebase submit failed", e);
      }
    }
    // fallback local
    try {
      const raw = localStorage.getItem(LOCAL_LEADERBOARD_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push({ name: playerName.trim(), score: final, timestamp: Date.now() });
      arr.sort((a,b)=>b.score-a.score);
      const sliced = arr.slice(0,100);
      localStorage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(sliced));
      setLeaderboard(sliced);
      alert("Saved locally to leaderboard ✅");
    } catch (e) {
      alert("Failed to save leaderboard locally");
    }
  };

  // reset to menu
  const quitToMenu = () => {
    stopLoop();
    setGameState("menu");
    setCakeStack([]);
    setMovingCake(null);
    setFallingPieces([]);
    setScore(0);
    setCombo(0);
  };

  // small helper to render cake layer SVG
  const CakeLayer = ({ w, styleObj }) => {
    const h = styleObj.height;
    const sprinkleCount = Math.max(0, Math.min(12, Math.floor(w / 12)));
    const rx = Math.max(6, Math.min(12, Math.floor(w * 0.06)));
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`grad-${w}-${styleObj.base}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={styleObj.base} />
            <stop offset="100%" stopColor={styleObj.base} stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <ellipse cx={w/2} cy={h-1} rx={w/2.2} ry="4" fill="rgba(0,0,0,0.22)" />
        <rect x={3} y={14} width={Math.max(10,w-6)} height={h-16} fill={`url(#grad-${w}-${styleObj.base})`} rx={rx} />
        <rect x={3} y={14} width="10" height={h-16} fill="rgba(255,255,255,0.12)" rx={rx}/>
        <rect x={w-13} y={14} width="10" height={h-16} fill="rgba(0,0,0,0.12)" rx={rx}/>
        {/* frosting drip */}
        <path d={(() => {
          const pts = []; const steps = 8;
          for (let i=0;i<steps;i++){
            const xp = 3 + (w-6) * (i/(steps-1));
            const yp = 14 + (i%2 ? 8 : 4);
            pts.push(`${i===0?'M':'L'} ${xp} ${yp}`);
          }
          return pts.join(" ") + ` L ${w-3} 14 L ${w-3} 8 L 3 8 Z`;
        })()} fill={styleObj.frosting}/>
        <ellipse cx={w/2} cy="8" rx={(w-6)/2} ry="7" fill={styleObj.frosting}/>
        <ellipse cx={w/2} cy="6" rx={(w-6)/3} ry="4" fill={styleObj.cream} opacity="0.6"/>
        {w > 40 && [...Array(sprinkleCount)].map((_, i) => {
          const angle = (i * 360 / sprinkleCount) + (i%2?10:-10);
          const radius = (w / 4) + (i%3)*2;
          const cx = w/2 + Math.cos(angle * Math.PI / 180) * radius;
          const cy = 10 + Math.sin(angle * Math.PI / 180) * 4;
          const color = styleObj.sprinkles[i % styleObj.sprinkles.length];
          const rot = (i*37) % 180;
          return <rect key={i} x={cx-1.5} y={cy-3} width="3" height="6" fill={color} rx="1.5" transform={`rotate(${rot} ${cx} ${cy})`} />;
        })}
        {w > 50 && (
          <>
            <circle cx="12" cy={h*0.35} r="4" fill={styleObj.cream} opacity="0.7" />
            <circle cx="12" cy={h*0.55} r="4" fill={styleObj.cream} opacity="0.7" />
            <circle cx="12" cy={h*0.75} r="4" fill={styleObj.cream} opacity="0.7" />
            <circle cx={w-12} cy={h*0.35} r="4" fill={styleObj.cream} opacity="0.7" />
            <circle cx={w-12} cy={h*0.55} r="4" fill={styleObj.cream} opacity="0.7" />
            <circle cx={w-12} cy={h*0.75} r="4" fill={styleObj.cream} opacity="0.7" />
          </>
        )}
      </svg>
    );
  };

  /* ========= RENDER UI ========== */
  return (
    <div ref={containerRef} className="app-shell" style={{ backgroundImage: `url(${BACKGROUNDS[bgIndex]})` }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,rgba(0,0,0,0.28),rgba(0,0,0,0.5))" }} />
      <div className="card" style={{ position: "relative", zIndex: 2 }}>
        {/* Header & Controls */}
        <div className="header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="huge">🎂</div>
            <div>
              <div className="title">Cake Tower</div>
              <div className="lead">Tap/click or press SPACE to stack. Perfect stacks give combos & bonuses.</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ background: "#fff", padding: "6px 10px", borderRadius: 10 }}>Score <strong style={{ marginLeft: 6 }}>{score}</strong></div>
              <div style={{ background: "#fff", padding: "6px 10px", borderRadius: 10 }}>Best <strong style={{ marginLeft: 6 }}>{highScore}</strong></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="Your name (required)" value={playerName} onChange={e => setPlayerName(e.target.value)} />
              <button className="btn" onClick={() => { setBgIndex((b) => (b + 1) % BACKGROUNDS.length); }}>Shuffle BG</button>
            </div>
          </div>
        </div>

        {/* Game area */}
        <div style={{ marginTop: 12 }}>
          <div className="game-area" style={{ width: canvasW, height: canvasH }} onClick={() => { if (gameState === "playing") onStack(); }}>
            {/* stacked layers (render last N only) */}
            <div style={{ position: "absolute", bottom: 20, left: 0, right: 0 }}>
              {cakeStack.slice(Math.max(0, cakeStack.length - 13)).map((c, idx) => {
                // compute y offset
                const slice = cakeStack.slice(Math.max(0, cakeStack.length - 13));
                const localIdx = slice.indexOf(c);
                const yOffset = slice.slice(localIdx + 1).reduce((s, cx) => s + cx.style.height, 0);
                return (
                  <div key={c.x + "-" + c.width + "-" + idx} style={{ position: "absolute", left: `${c.x}px`, bottom: `${yOffset + 20}px`, width: `${c.width}px`, height: `${c.style.height}px` }}>
                    <CakeLayer w={c.width} styleObj={c.style} />
                  </div>
                );
              })}
            </div>

            {/* moving cake */}
            {movingCake && (
              <div style={{ position: "absolute", top: 50, left: movingCake.x, width: movingCake.width, height: movingCake.style.height }}>
                <CakeLayer w={movingCake.width} styleObj={movingCake.style} />
              </div>
            )}

            {/* falling pieces */}
            {fallingPieces.map((p, i) => (
              <div key={i} style={{ position: "absolute", left: p.x, top: p.y, width: p.width, height: p.style.height, transform: `rotate(${p.rot || 0}deg)` }}>
                <CakeLayer w={p.width} styleObj={p.style} />
              </div>
            ))}
          </div>

          {/* controls */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {gameState !== "playing" ? (
              <>
                <button className="btn" onClick={() => startGame()}>Start Game</button>
                <button className="btn-muted" onClick={() => {
                  // show leaderboard modal - we simulate by switching background to leaderboard view below by toggling flag
                  const raw = localStorage.getItem(LOCAL_LEADERBOARD_KEY);
                  if (raw) setLeaderboard(JSON.parse(raw));
                  else setLeaderboard([]);
                  setGameState("menu"); // stay in menu but show alert
                  alert("Open Leaderboard from menu results after finishing a game. Or submit your score after Game Over.");
                }}>Leaderboard</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => onStack()}>STACK IT!</button>
                <button className="btn-muted" onClick={() => { quitToMenu(); }}>Quit</button>
              </>
            )}

            <div style={{ flex: 1 }} />
            <div style={{ alignSelf: "center", color: "#666", fontSize: 14 }}>Combo: <strong>{combo}</strong></div>
          </div>
        </div>

        {/* gameover area */}
        {gameState === "gameover" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: "#fff", padding: 12, borderRadius: 12 }}>
              <div style={{ fontSize: 22 }}>{score > 0 ? "Nice!" : "Womp!"}</div>
              <div style={{ marginTop: 8 }}>Score: <strong>{score}</strong></div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => { share(); }}>Share</button>
                <button className="btn-muted" onClick={() => submitLeaderboard()}>Submit Score</button>
                <button className="btn-muted" onClick={() => { startGame(); }}>Play Again</button>
                <button className="btn-muted" onClick={() => { quitToMenu(); }}>Main Menu</button>
              </div>
            </div>
          </div>
        )}

        {/* leaderboard preview */}
        <div style={{ marginTop: 12 }}>
          <div style={{ background: "#fff", padding: 10, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Top Players</div>
              <div style={{ fontSize: 13, color: "#666" }}>{useFirebase ? "Global (Firebase)" : "Local"}</div>
            </div>
            <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
              {leaderboard.length === 0 ? <div style={{ color: "#666" }}>No entries yet</div> : leaderboard.slice(0, 10).map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                  <div><strong>{i<3 ? (i===0?'🥇':i===1?'🥈':'🥉') : `#${i+1}`}</strong> <span style={{ marginLeft: 8 }}>{e.name}{playerName && e.name.toLowerCase() === playerName.toLowerCase() && <em style={{ marginLeft: 8, background: "#2563eb", color: "#fff", padding: "2px 8px", borderRadius: 8 }}>YOU</em>}</span></div>
                  <div><strong>{e.score}</strong></div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}