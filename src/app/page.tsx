"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import {
  createScoreRecord,
  fetchScoreRecords,
  getTop3Records,
  type SheetRecord,
} from "@/lib/googleSheets";

type BrickColor = {
  id: string;
  name: string;
  fill: string;
  border: string;
  isRed?: boolean;
};

const BRICK_COLORS: BrickColor[] = [
  { id: "red", name: "연한 빨강", fill: "#fca5a5", border: "#f87171", isRed: true },
  { id: "orange", name: "연한 주황", fill: "#fdba74", border: "#fb923c" },
  { id: "yellow", name: "연한 노랑", fill: "#fde047", border: "#eab308" },
  { id: "blue", name: "연한 파랑", fill: "#93c5fd", border: "#60a5fa" },
  { id: "green", name: "연한 녹색", fill: "#86efac", border: "#4ade80" },
  { id: "purple", name: "연한 보라", fill: "#d8b4fe", border: "#c084fc" },
];

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  status: number; // 1: alive, 0: broken
  color: BrickColor;
}

export default function BrickBreakerGame() {
  // Game states: "intro" | "countdown" | "playing" | "paused" | "gameover" | "clear"
  const [gameState, setGameState] = useState<
    "intro" | "countdown" | "playing" | "paused" | "gameover" | "clear"
  >("intro");

  const [userName, setUserName] = useState("");
  const [lives, setLives] = useState(3);
  const [redClearedCount, setRedClearedCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalTimeStr, setFinalTimeStr] = useState("");
  const [countdown, setCountdown] = useState(3);

  // Google Sheets Top 3 Ranking & Save status
  const [top3List, setTop3List] = useState<SheetRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");

  // Audio refs
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Canvas & Game loop refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number | null>(null);

  // Canvas Logical Dimensions
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 540;

  // Paddle
  const paddleWidth = 110;
  const paddleHeight = 14;
  const paddleY = CANVAS_HEIGHT - 35;
  const paddleXRef = useRef<number>((CANVAS_WIDTH - paddleWidth) / 2);
  const paddleSpeed = 8;
  const keysPressedRef = useRef<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Ball
  const ballRadius = 8;
  const ballPosRef = useRef<{ x: number; y: number }>({
    x: CANVAS_WIDTH / 2,
    y: paddleY - ballRadius - 2,
  });
  const ballSpeedRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Bricks (5 rows x 8 columns = 40)
  const brickRows = 5;
  const brickCols = 8;
  const bricksRef = useRef<Brick[]>([]);
  const redClearedRef = useRef(0);
  const livesRef = useRef(3);

  // Sound generator using Web Audio API for hit sound
  const playHitSound = useCallback((isRedBrick = false) => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = isRedBrick ? "triangle" : "sine";
      osc.frequency.setValueAtTime(isRedBrick ? 780 : 540, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        isRedBrick ? 1200 : 800,
        ctx.currentTime + 0.1
      );

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Format seconds into MM:SS
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Generate Bricks with 30% light red (12 out of 40)
  const initBricks = useCallback(() => {
    const totalBricks = brickRows * brickCols; // 40
    const redCount = Math.round(totalBricks * 0.3); // 12
    const otherColors = BRICK_COLORS.filter((c) => !c.isRed);

    // Pick 12 random unique indices for red bricks
    const redIndices = new Set<number>();
    while (redIndices.size < redCount) {
      const randIdx = Math.floor(Math.random() * totalBricks);
      redIndices.add(randIdx);
    }

    const redColor = BRICK_COLORS.find((c) => c.isRed)!;

    const bricks: Brick[] = [];
    const brickPadding = 8;
    const brickOffsetTop = 50;
    const brickOffsetLeft = 36;
    const brickWidth =
      (CANVAS_WIDTH - brickOffsetLeft * 2 - (brickCols - 1) * brickPadding) /
      brickCols;
    const brickHeight = 22;

    for (let r = 0; r < brickRows; r++) {
      for (let c = 0; c < brickCols; c++) {
        const idx = r * brickCols + c;
        const isRed = redIndices.has(idx);
        const color = isRed
          ? redColor
          : otherColors[Math.floor(Math.random() * otherColors.length)];

        const brickX = brickOffsetLeft + c * (brickWidth + brickPadding);
        const brickY = brickOffsetTop + r * (brickHeight + brickPadding);

        bricks.push({
          x: brickX,
          y: brickY,
          width: brickWidth,
          height: brickHeight,
          status: 1,
          color,
        });
      }
    }
    bricksRef.current = bricks;
  }, []);

  // Keyboard events for Left & Right Arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.code === "ArrowLeft") {
        keysPressedRef.current.left = true;
      } else if (e.key === "ArrowRight" || e.code === "ArrowRight") {
        keysPressedRef.current.right = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.code === "ArrowLeft") {
        keysPressedRef.current.left = false;
      } else if (e.key === "ArrowRight" || e.code === "ArrowRight") {
        keysPressedRef.current.right = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Touch and Mouse Dragging for Paddle (Mobile & Desktop pointer)
  const handleTouchOrPointerMove = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const relativeX = (clientX - rect.left) * scaleX;
    // Center paddle around touch/pointer position
    const newPaddleX = Math.max(
      0,
      Math.min(CANVAS_WIDTH - paddleWidth, relativeX - paddleWidth / 2)
    );
    paddleXRef.current = newPaddleX;
  }, []);

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (gameState !== "playing") return;
    if (e.touches.length > 0) {
      handleTouchOrPointerMove(e.touches[0].clientX);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gameState !== "playing") return;
    // Only drag with pointer if it's touch or left button is held down
    if (e.pointerType === "touch" || e.buttons === 1) {
      handleTouchOrPointerMove(e.clientX);
    }
  };


  // BGM control
  const startBgm = useCallback(() => {
    if (!bgmRef.current) {
      const audio = new Audio("/Hyper_Speed_Run.mp3");
      audio.loop = true;
      audio.volume = 0.25; // 볼륨이 너무 크지 않도록 25% 설정
      bgmRef.current = audio;
    }
    bgmRef.current.currentTime = 0;
    bgmRef.current.play().catch((err) => {
      console.log("Audio autoplay prevented:", err);
    });
  }, []);

  const pauseBgm = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.pause();
    }
  }, []);

  const resumeBgm = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.play().catch(() => {});
    }
  }, []);

  const stopBgm = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
  }, []);

  // Reset ball position
  const resetBallAndPaddle = useCallback(() => {
    paddleXRef.current = (CANVAS_WIDTH - paddleWidth) / 2;
    ballPosRef.current = {
      x: CANVAS_WIDTH / 2,
      y: paddleY - ballRadius - 4,
    };
    // Launch angle slightly random upward
    const angle = (Math.PI / 4) + (Math.random() * (Math.PI / 2)); // 45 ~ 135 deg
    const speed = 5.2;
    ballSpeedRef.current = {
      dx: speed * Math.cos(angle) * (Math.random() > 0.5 ? 1 : -1),
      dy: -speed * Math.sin(angle),
    };
  }, []);

  // Timer effect: counts only during "playing"
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (gameState === "playing") {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [gameState]);

  // Handle Game Clear
  const triggerClear = useCallback(
    async (currentSeconds: number) => {
      setGameState("clear");
      stopBgm();
      const timeStr = formatTime(currentSeconds);
      setFinalTimeStr(timeStr);

      // 1. Google Sheets에 클리어 완료 시간 비동기 저장
      setSaveStatus("saving");
      try {
        const ok = await createScoreRecord(userName, timeStr);
        setSaveStatus(ok ? "success" : "error");

        // 2. 전체 기록 조회 후 Top 3 계산
        const allRecords = await fetchScoreRecords();
        const top3 = getTop3Records(allRecords);
        setTop3List(top3);
      } catch (err) {
        console.error("Score save / fetch error:", err);
        setSaveStatus("error");
      }

      // Confetti firework effects
      try {
        const count = 200;
        const defaults = {
          origin: { y: 0.7 },
        };

        function fire(particleRatio: number, opts: confetti.Options) {
          confetti({
            ...defaults,
            ...opts,
            particleCount: Math.floor(count * particleRatio),
          });
        }

        fire(0.25, {
          spread: 26,
          startVelocity: 55,
        });
        fire(0.2, {
          spread: 60,
        });
        fire(0.35, {
          spread: 100,
          decay: 0.91,
          scalar: 0.8,
        });
        fire(0.1, {
          spread: 120,
          startVelocity: 25,
          decay: 0.92,
          scalar: 1.2,
        });
        fire(0.1, {
          spread: 120,
          startVelocity: 45,
        });
      } catch (err) {
        console.error("Confetti error:", err);
      }
    },
    [stopBgm, userName]
  );

  // Handle Game Over
  const triggerGameOver = useCallback(() => {
    setGameState("gameover");
    stopBgm();
  }, [stopBgm]);

  // Start button clicked from Intro
  const handleStartGame = () => {
    if (!userName.trim()) {
      alert("사용자 이름을 입력해 주세요!");
      return;
    }
    initBricks();
    setLives(3);
    livesRef.current = 3;
    setRedClearedCount(0);
    redClearedRef.current = 0;
    setElapsedSeconds(0);
    setFinalTimeStr("");
    resetBallAndPaddle();

    // Start BGM
    startBgm();

    // Countdown: 3, 2, 1
    setCountdown(3);
    setGameState("countdown");
  };

  // Countdown timer effect
  useEffect(() => {
    if (gameState !== "countdown") return;

    if (countdown > 1) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 1) {
      const timer = setTimeout(() => {
        setGameState("playing");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameState, countdown]);

  // Pause / Resume Toggle
  const handleTogglePause = () => {
    if (gameState === "playing") {
      setGameState("paused");
      pauseBgm();
    } else if (gameState === "paused") {
      setGameState("playing");
      resumeBgm();
    }
  };

  // Quit Game (Return to Intro)
  const handleQuitGame = () => {
    stopBgm();
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    setGameState("intro");
  };

  // Main Canvas Render & Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      // 1. Clear background
      ctx.fillStyle = "#1e293b"; // Slate-800
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Subtle grid background effect
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < CANVAS_WIDTH; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < CANVAS_HEIGHT; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // 2. Draw Bricks
      bricksRef.current.forEach((brick) => {
        if (brick.status === 1) {
          ctx.beginPath();
          ctx.roundRect(brick.x, brick.y, brick.width, brick.height, 4);
          ctx.fillStyle = brick.color.fill;
          ctx.fill();
          ctx.strokeStyle = brick.color.border;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.closePath();

          // Highlight effect inside brick
          ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
          ctx.fillRect(brick.x + 2, brick.y + 2, brick.width - 4, 3);
        }
      });

      // 3. Move Paddle if Playing
      if (gameState === "playing") {
        if (keysPressedRef.current.left) {
          paddleXRef.current = Math.max(0, paddleXRef.current - paddleSpeed);
        }
        if (keysPressedRef.current.right) {
          paddleXRef.current = Math.min(
            CANVAS_WIDTH - paddleWidth,
            paddleXRef.current + paddleSpeed
          );
        }
      }

      // 4. Draw Paddle
      const pX = paddleXRef.current;
      ctx.beginPath();
      ctx.roundRect(pX, paddleY, paddleWidth, paddleHeight, 7);
      const paddleGradient = ctx.createLinearGradient(
        pX,
        paddleY,
        pX,
        paddleY + paddleHeight
      );
      paddleGradient.addColorStop(0, "#38bdf8");
      paddleGradient.addColorStop(1, "#0284c7");
      ctx.fillStyle = paddleGradient;
      ctx.fill();
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.closePath();

      // 5. Draw Ball
      const { x: bX, y: bY } = ballPosRef.current;
      ctx.beginPath();
      ctx.arc(bX, bY, ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0; // reset shadow
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.closePath();

      // 6. Physics and updates only when "playing"
      if (gameState === "playing") {
        let newX = bX + ballSpeedRef.current.dx;
        let newY = bY + ballSpeedRef.current.dy;

        // Collision with left/right walls
        if (newX - ballRadius <= 0) {
          newX = ballRadius;
          ballSpeedRef.current.dx = Math.abs(ballSpeedRef.current.dx);
        } else if (newX + ballRadius >= CANVAS_WIDTH) {
          newX = CANVAS_WIDTH - ballRadius;
          ballSpeedRef.current.dx = -Math.abs(ballSpeedRef.current.dx);
        }

        // Collision with top wall
        if (newY - ballRadius <= 0) {
          newY = ballRadius;
          ballSpeedRef.current.dy = Math.abs(ballSpeedRef.current.dy);
        }

        // Collision with Paddle
        if (
          newY + ballRadius >= paddleY &&
          newY - ballRadius <= paddleY + paddleHeight &&
          newX >= pX - ballRadius &&
          newX <= pX + paddleWidth + ballRadius &&
          ballSpeedRef.current.dy > 0
        ) {
          // Calculate bounce angle depending on hit position on paddle
          const hitPos = (newX - (pX + paddleWidth / 2)) / (paddleWidth / 2); // -1 to 1
          const maxAngle = (75 * Math.PI) / 180;
          const bounceAngle = hitPos * maxAngle;
          const currentSpeed = Math.sqrt(
            ballSpeedRef.current.dx * ballSpeedRef.current.dx +
              ballSpeedRef.current.dy * ballSpeedRef.current.dy
          );

          ballSpeedRef.current.dx = currentSpeed * Math.sin(bounceAngle);
          ballSpeedRef.current.dy = -Math.abs(currentSpeed * Math.cos(bounceAngle));
          newY = paddleY - ballRadius;
        }

        // Collision with Bricks
        for (let i = 0; i < bricksRef.current.length; i++) {
          const b = bricksRef.current[i];
          if (b.status === 1) {
            // Check bounding box intersection
            if (
              newX + ballRadius >= b.x &&
              newX - ballRadius <= b.x + b.width &&
              newY + ballRadius >= b.y &&
              newY - ballRadius <= b.y + b.height
            ) {
              b.status = 0; // break brick

              // Determine bounce direction
              const prevX = bX;
              const prevY = bY;
              if (prevX + ballRadius <= b.x || prevX - ballRadius >= b.x + b.width) {
                ballSpeedRef.current.dx = -ballSpeedRef.current.dx;
              } else {
                ballSpeedRef.current.dy = -ballSpeedRef.current.dy;
              }

              const isRed = b.color.isRed === true;
              playHitSound(isRed);

              if (isRed) {
                redClearedRef.current += 1;
                setRedClearedCount(redClearedRef.current);

                // 연한 빨강색 벽돌 세 개 제거 시 미션 성공!
                if (redClearedRef.current >= 3) {
                  triggerClear(elapsedSeconds);
                  return;
                }
              }

              break; // one brick per frame collision
            }
          }
        }

        // Missed Ball (Bottom fall)
        if (newY - ballRadius > CANVAS_HEIGHT) {
          livesRef.current -= 1;
          setLives(livesRef.current);

          if (livesRef.current <= 0) {
            triggerGameOver();
            return;
          } else {
            // Respawn ball and pause briefly
            resetBallAndPaddle();
            return;
          }
        }

        ballPosRef.current = { x: newX, y: newY };
      }

      // Draw Countdown Overlay if in countdown state
      if (gameState === "countdown") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        ctx.font = "bold 72px sans-serif";
        ctx.fillStyle = "#facc15";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#eab308";
        ctx.shadowBlur = 15;
        ctx.fillText(String(countdown), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.shadowBlur = 0;
      }

      // Draw Paused Overlay if paused
      if (gameState === "paused") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        ctx.font = "bold 36px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("게임 일시 정지", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      }

      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame(render);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [
    gameState,
    countdown,
    elapsedSeconds,
    playHitSound,
    resetBallAndPaddle,
    triggerClear,
    triggerGameOver,
  ]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white flex flex-col items-center justify-center p-4">
      {/* 1. 첫 화면: 이름 입력 & 시작 버튼 & 캐릭터 이미지 */}
      {gameState === "intro" && (
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl shadow-2xl p-8 max-w-md w-full flex flex-col items-center backdrop-blur-md transition-all">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-2">
            INU 벽돌깨기
          </h1>
          <p className="text-xs text-cyan-300 font-semibold tracking-wider mb-6 bg-cyan-950/60 px-3 py-1 rounded-full border border-cyan-800">
            해양학과 202400448 장서윤
          </p>

          {/* Mascot Image */}
          <div className="relative w-48 h-48 mb-6 rounded-2xl overflow-hidden shadow-lg border-2 border-indigo-500/40 bg-slate-900/50 flex items-center justify-center">
            <Image
              src="/Mascot.jpg"
              alt="Mascot Character"
              fill
              className="object-cover hover:scale-105 transition-transform duration-300"
              priority
            />
          </div>

          {/* Game Rules Summary */}
          <div className="w-full bg-slate-900/60 rounded-xl p-4 mb-6 text-xs text-slate-300 space-y-1.5 border border-slate-700/50">
            <p className="font-bold text-yellow-300 mb-1 flex items-center gap-1">
              🎯 게임 미션 & 조작 안내
            </p>
            <p>• PC 버전 <span className="text-white font-semibold">좌우 방향키(←, →)</span>로 패들 이동</p>
            <p>• <span className="text-red-300 font-semibold">연한 빨강 벽돌 3개</span>를 깨면 미션 클리어!</p>
            <p>• 하단으로 공이 떨어지면 생명 감소 (기본 <span className="text-pink-400 font-semibold">생명 3개</span>)</p>
          </div>

          {/* User Name Input */}
          <div className="w-full space-y-2 mb-6">
            <label
              htmlFor="userName"
              className="block text-sm font-medium text-slate-200"
            >
              사용자 이름
            </label>
            <input
              id="userName"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="이름을 입력하세요"
              maxLength={15}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStartGame();
              }}
              className="w-full px-4 py-3 rounded-lg bg-slate-900/90 border border-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 text-white placeholder-slate-400 text-sm outline-none transition-all"
            />
          </div>

          {/* Start Button */}
          <button
            onClick={handleStartGame}
            className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-base shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
          >
            <span>게임 시작</span>
            <span className="text-lg">🎮</span>
          </button>
        </div>
      )}

      {/* 2. 게임 화면: Canvas + 상태 UI + 일시정지/종료 버튼 */}
      {gameState !== "intro" && (
        <div className="flex flex-col items-center w-full max-w-4xl">
          {/* Header Info Bar: 모바일 친화적 2줄 또는 유연한 배치 */}
          <div className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl p-2.5 sm:p-3.5 mb-2.5 flex flex-col sm:flex-row items-center justify-between gap-2.5 shadow-lg">
            {/* 1st row on mobile: Title & Player & Buttons */}
            <div className="w-full sm:w-auto flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-cyan-400 text-base sm:text-lg tracking-tight">
                  INU 벽돌깨기
                </span>
                <span className="text-[11px] sm:text-xs bg-slate-700/80 px-2 py-0.5 rounded-md text-slate-300 truncate max-w-[110px] sm:max-w-[160px]">
                  <strong className="text-white">{userName}</strong>
                </span>
              </div>

              {/* Game Control Buttons (Mobile inline right, Desktop right) */}
              <div className="flex sm:hidden items-center gap-1.5">
                <button
                  onClick={handleTogglePause}
                  disabled={gameState === "gameover" || gameState === "clear" || gameState === "countdown"}
                  className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-[11px] font-semibold rounded-lg border border-slate-600 transition-colors"
                >
                  {gameState === "paused" ? "계속 ▶" : "일시정지 ❚❚"}
                </button>
                <button
                  onClick={handleQuitGame}
                  className="px-2.5 py-1 bg-red-600/80 hover:bg-red-600 text-[11px] font-semibold rounded-lg border border-red-500 transition-all"
                >
                  종료 ✕
                </button>
              </div>
            </div>

            {/* 2nd row on mobile / Middle on Desktop: Status Badges */}
            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-center gap-1.5 sm:gap-3 text-xs sm:text-sm font-medium">
              {/* Target Mission Progress */}
              <div className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-red-950/40 border border-red-800/50 px-2 sm:px-3 py-1 rounded-lg">
                <span className="text-[11px] sm:text-xs text-red-300">빨강:</span>
                <span className="font-mono font-bold text-red-400 text-xs sm:text-base">
                  {redClearedCount} / 3
                </span>
              </div>

              {/* Lives */}
              <div className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-pink-950/40 border border-pink-800/50 px-2 sm:px-3 py-1 rounded-lg">
                <span className="text-[11px] sm:text-xs text-pink-300">생명:</span>
                <div className="flex gap-0.5 text-xs sm:text-base">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span
                      key={i}
                      className={
                        i < lives ? "text-pink-400 opacity-100" : "text-slate-600"
                      }
                    >
                      ❤️
                    </span>
                  ))}
                </div>
              </div>

              {/* Timer */}
              <div className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-cyan-950/40 border border-cyan-800/50 px-2 sm:px-3 py-1 rounded-lg font-mono">
                <span className="text-[11px] sm:text-xs text-cyan-300">시간:</span>
                <span className="font-bold text-cyan-400 text-xs sm:text-base">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
            </div>

            {/* Desktop Control Buttons */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={handleTogglePause}
                disabled={gameState === "gameover" || gameState === "clear" || gameState === "countdown"}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:hover:bg-slate-700 text-xs font-semibold rounded-lg transition-colors border border-slate-600"
              >
                {gameState === "paused" ? "계속하기 ▶" : "일시정지 ❚❚"}
              </button>
              <button
                onClick={handleQuitGame}
                className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 active:scale-95 text-xs font-semibold rounded-lg transition-all border border-red-500"
              >
                게임 종료 ✕
              </button>
            </div>
          </div>

          {/* Canvas Viewport: Touch-action none for smooth dragging */}
          <div className="relative w-full max-w-full rounded-2xl overflow-hidden border-2 border-slate-700 shadow-2xl bg-slate-900 touch-none select-none">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onTouchMove={handleTouchMove}
              onTouchStart={handleTouchMove}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerMove}
              className="block w-full h-auto cursor-pointer"
            />

            {/* Clear Modal Overlay */}
            {gameState === "clear" && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-fade-in">
                <div className="text-4xl sm:text-5xl mb-2">🎉</div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-purple-400 mb-2">
                  게임 미션 완료!
                </h2>
                <p className="text-slate-300 text-xs sm:text-sm mb-4">
                  연한 빨강 벽돌 3개를 모두 성공적으로 제거했습니다!
                </p>

                {/* 측정된 완료 시간 출력 */}
                <div className="bg-slate-800/90 border border-slate-700 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl mb-3 shadow-inner">
                  <div className="text-[11px] sm:text-xs text-slate-400 mb-0.5">내 완료 소요 시간</div>
                  <div className="text-xl sm:text-2xl font-mono font-bold text-yellow-300">
                    ⏱️ {finalTimeStr}
                  </div>
                  {/* Google Sheets 저장 상태 안내 */}
                  <div className="text-[11px] mt-1 text-slate-400 flex items-center justify-center gap-1">
                    {saveStatus === "saving" && <span className="text-cyan-400 animate-pulse">구글 시트에 기록 저장 중...</span>}
                    {saveStatus === "success" && <span className="text-emerald-400">✓ 구글 시트 저장 완료</span>}
                    {saveStatus === "error" && <span className="text-amber-400">⚠️ 구글 시트 저장 실패 (오프라인 모드)</span>}
                  </div>
                </div>

                {/* 구글 시트 기록 기반 빠른 순위 Top 3 (이름 + 분:초 형태의 완료 시간) */}
                <div className="w-full max-w-xs bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 mb-4 shadow">
                  <h3 className="text-xs font-bold text-amber-300 mb-2 flex items-center justify-center gap-1">
                    🏆 명예의 전당 Top 3
                  </h3>
                  {top3List.length === 0 ? (
                    <p className="text-[11px] text-slate-400 py-2">
                      {saveStatus === "saving" ? "랭킹을 불러오는 중..." : "등록된 기록이 없습니다."}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {top3List.map((rec, idx) => {
                        const medal = idx === 0 ? "🥇 1위" : idx === 1 ? "🥈 2위" : "🥉 3위";
                        const isCurrent = rec.name === userName && rec.finishtime === finalTimeStr;
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border ${
                              isCurrent
                                ? "bg-amber-500/20 border-amber-500/60 text-white font-bold"
                                : "bg-slate-800/60 border-slate-700/50 text-slate-300"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-semibold text-amber-400">{medal}</span>
                              <span className="truncate max-w-[90px] text-slate-200 font-medium">
                                {rec.name}
                              </span>
                            </span>
                            <span className="font-mono text-cyan-300 font-bold text-xs sm:text-sm tracking-wide">
                              ⏱️ {rec.finishtime}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-center w-full max-w-xs">
                  <button
                    onClick={handleQuitGame}
                    className="w-full py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                  >
                    <span>첫 화면으로 돌아가기</span>
                    <span>🏠</span>
                  </button>
                </div>
              </div>
            )}

            {/* Game Over Modal Overlay */}
            {gameState === "gameover" && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-fade-in">
                <div className="text-4xl sm:text-5xl mb-2">💥</div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-red-500 mb-2 sm:mb-3">
                  게임 미션 실패
                </h2>
                <p className="text-slate-300 text-xs sm:text-sm max-w-xs mb-5">
                  {userName} 님의 공을 모두 놓쳐 생명이 소진되었습니다. 다시 도전해 보세요!
                </p>

                <div className="flex gap-2 sm:gap-3">
                  <button
                    onClick={handleStartGame}
                    className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-red-600 hover:bg-red-500 font-bold text-xs sm:text-sm shadow transition-all"
                  >
                    다시 시작
                  </button>
                  <button
                    onClick={handleQuitGame}
                    className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold text-xs sm:text-sm shadow transition-all"
                  >
                    첫 화면으로
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Guide tip without music source */}
          <div className="w-full flex justify-center sm:justify-start items-center text-[11px] sm:text-xs text-slate-400 mt-2 px-1 text-center sm:text-left">
            <span>💡 PC: 방향키 [←] [→] / 모바일: 화면 터치 드래그로 패들 이동</span>
          </div>
        </div>
      )}
    </main>
  );
}
