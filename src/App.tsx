/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

// --- Types ---

interface Vector {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface BallState {
  pos: Vector;
  vel: Vector;
  radius: number;
  squish: number; // 1.0 is normal, < 1.0 is squished
  squishAngle: number;
  trail: Vector[];
  isPaused: boolean;
  pauseTimer: number;
}

// --- Constants ---

const BALL_RADIUS = 30;
const TRAIL_LENGTH = 10;
const MAX_SPEED = 12;
const MIN_SPEED = 2;
const FRICTION = 0.995;
const BOUNCE_RANDOMNESS = 0.3; // Radians (~17 degrees)
const BG_COLOR = '#1a1a1a';
const BALL_COLOR = '#ffff00'; // High contrast yellow for cats
const CYAN_COLOR = '#00ffff';

// --- Audio Helper ---

class CatAudio {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playTick() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playChirp() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // High-pitched bird-like chirp
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(3000, now + 0.05);
    osc.frequency.exponentialRampToValueAtTime(2000, now + 0.1);
    
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(now + 0.1);
  }

  playFlutter() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // Very quiet, high-pitched flutter/buzz
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2000, now);
    osc.frequency.linearRampToValueAtTime(2500, now + 0.02);
    osc.frequency.linearRampToValueAtTime(2000, now + 0.04);
    
    gain.gain.setValueAtTime(0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(now + 0.05);
  }

  playCatch() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Bell-like sound
    [880, 1320, 1760].forEach(freq => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start();
      osc.stop(now + 0.5);
    });
  }
}

const audioManager = new CatAudio();

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [score, setScore] = useState(0);
  const [ballColor, setBallColor] = useState(BALL_COLOR);
  
  const stateRef = useRef<BallState>({
    pos: { x: 100, y: 100 },
    vel: { x: 5, y: 5 },
    radius: BALL_RADIUS,
    squish: 1,
    squishAngle: 0,
    trail: [],
    isPaused: false,
    pauseTimer: 0,
  });

  const particlesRef = useRef<Particle[]>([]);

  const resetBall = useCallback((canvasWidth: number, canvasHeight: number) => {
    const side = Math.random() > 0.5 ? 'left' : 'right';
    stateRef.current = {
      ...stateRef.current,
      pos: {
        x: side === 'left' ? BALL_RADIUS * 2 : canvasWidth - BALL_RADIUS * 2,
        y: Math.random() * (canvasHeight - BALL_RADIUS * 4) + BALL_RADIUS * 2,
      },
      vel: {
        x: (side === 'left' ? 1 : -1) * (Math.random() * 5 + 5),
        y: (Math.random() - 0.5) * 10,
      },
      squish: 1,
      isPaused: false,
      pauseTimer: 0,
    };
  }, []);

  const createBurst = (x: number, y: number) => {
    for (let i = 0; i < 20; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        life: 1.0,
        color: ballColor,
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      resetBall(canvas.width, canvas.height);
    };

    window.addEventListener('resize', resize);
    resize();

    const update = () => {
      if (!isPlaying) return;

      const state = stateRef.current;
      const { width, height } = canvas;

      // Pause logic (Biological feel)
      if (state.isPaused) {
        state.pauseTimer--;
        if (state.pauseTimer <= 0) {
          state.isPaused = false;
          if (!isMuted) audioManager.playChirp();
          // Sudden burst after pause
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 8 + 6;
          state.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
        }
      } else {
        // Movement
        state.pos.x += state.vel.x;
        state.pos.y += state.vel.y;

        // Friction
        state.vel.x *= FRICTION;
        state.vel.y *= FRICTION;

        // Trail
        state.trail.unshift({ ...state.pos });
        if (state.trail.length > TRAIL_LENGTH) state.trail.pop();

        // Bounce Logic with randomness
        let bounced = false;
        if (state.pos.x - state.radius < 0) {
          state.pos.x = state.radius;
          state.vel.x = Math.abs(state.vel.x);
          state.vel.y += (Math.random() - 0.5) * BOUNCE_RANDOMNESS * 10;
          state.squish = 0.6;
          state.squishAngle = 0;
          bounced = true;
        } else if (state.pos.x + state.radius > width) {
          state.pos.x = width - state.radius;
          state.vel.x = -Math.abs(state.vel.x);
          state.vel.y += (Math.random() - 0.5) * BOUNCE_RANDOMNESS * 10;
          state.squish = 0.6;
          state.squishAngle = 0;
          bounced = true;
        }

        if (state.pos.y - state.radius < 0) {
          state.pos.y = state.radius;
          state.vel.y = Math.abs(state.vel.y);
          state.vel.x += (Math.random() - 0.5) * BOUNCE_RANDOMNESS * 10;
          state.squish = 0.6;
          state.squishAngle = Math.PI / 2;
          bounced = true;
        } else if (state.pos.y + state.radius > height) {
          state.pos.y = height - state.radius;
          state.vel.y = -Math.abs(state.vel.y);
          state.vel.x += (Math.random() - 0.5) * BOUNCE_RANDOMNESS * 10;
          state.squish = 0.6;
          state.squishAngle = Math.PI / 2;
          bounced = true;
        }

        if (bounced && !isMuted) {
          audioManager.playTick();
        }

        // Recovery from squish
        state.squish += (1 - state.squish) * 0.2;

        // Random pause logic
        const speed = Math.sqrt(state.vel.x ** 2 + state.vel.y ** 2);
        if (speed < MIN_SPEED && Math.random() < 0.01) {
          state.isPaused = true;
          state.pauseTimer = Math.random() * 60 + 30;
        }

        // Speed limits
        if (speed > MAX_SPEED) {
          state.vel.x *= 0.95;
          state.vel.y *= 0.95;
        }

        // Flutter sound during motion
        if (speed > 2 && Math.random() < 0.02 && !isMuted) {
          audioManager.playFlutter();
        }

        // Anti-corner logic
        const cornerMargin = 100;
        const inCorner = 
          (state.pos.x < cornerMargin || state.pos.x > width - cornerMargin) &&
          (state.pos.y < cornerMargin || state.pos.y > height - cornerMargin);
        
        if (inCorner && speed < 3) {
          const toCenter = { x: width / 2 - state.pos.x, y: height / 2 - state.pos.y };
          const dist = Math.sqrt(toCenter.x ** 2 + toCenter.y ** 2);
          state.vel.x = (toCenter.x / dist) * 10;
          state.vel.y = (toCenter.y / dist) * 10;
        }
      }

      // Update particles
      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        return p.life > 0;
      });
    };

    const draw = () => {
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const state = stateRef.current;

      // Draw Trail
      state.trail.forEach((p, i) => {
        const alpha = (1 - i / TRAIL_LENGTH) * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, state.radius * (1 - i / TRAIL_LENGTH), 0, Math.PI * 2);
        ctx.fillStyle = `${ballColor}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.fill();
      });

      // Draw Particles
      particlesRef.current.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `${p.color}${Math.floor(p.life * 255).toString(16).padStart(2, '0')}`;
        ctx.fill();
      });

      // Draw Ball with Squish
      ctx.save();
      ctx.translate(state.pos.x, state.pos.y);
      ctx.rotate(state.squishAngle);
      ctx.scale(state.squish, 1 / state.squish);
      
      // Outer glow
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, state.radius);
      gradient.addColorStop(0, ballColor);
      gradient.addColorStop(0.8, ballColor);
      gradient.addColorStop(1, 'transparent');
      
      ctx.beginPath();
      ctx.arc(0, 0, state.radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Inner highlight
      ctx.beginPath();
      ctx.arc(-state.radius * 0.3, -state.radius * 0.3, state.radius * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fill();
      
      ctx.restore();

      animationFrameId = requestAnimationFrame(() => {
        update();
        draw();
      });
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying, isMuted, ballColor]);

  const handleInteraction = (clientX: number, clientY: number) => {
    if (!isPlaying) {
      setIsPlaying(true);
      return;
    }

    const state = stateRef.current;
    const dx = clientX - state.pos.x;
    const dy = clientY - state.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Catch detection (generous radius for cat paws)
    if (dist < state.radius * 2.5) {
      setScore(s => s + 1);
      if (!isMuted) audioManager.playCatch();
      createBurst(state.pos.x, state.pos.y);
      resetBall(window.innerWidth, window.innerHeight);
    } else {
      // Scare the ball away if missed but close
      if (dist < state.radius * 6) {
        const angle = Math.atan2(state.pos.y - clientY, state.pos.x - clientX);
        state.vel.x = Math.cos(angle) * 15;
        state.vel.y = Math.sin(angle) * 15;
        state.isPaused = false;
      }
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    // Handle multi-touch by checking all points
    for (let i = 0; i < e.touches.length; i++) {
      handleInteraction(e.touches[i].clientX, e.touches[i].clientY);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    handleInteraction(e.clientX, e.clientY);
  };

  return (
    <div 
      className="relative w-full h-screen overflow-hidden bg-[#1a1a1a] select-none touch-none"
      id="game-container"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-crosshair"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      />

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-2">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 pointer-events-auto"
          >
            <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono mb-1">Hunting Score</div>
            <div className="text-4xl font-bold text-white tabular-nums">{score}</div>
          </motion.div>
        </div>

        <div className="flex gap-3 pointer-events-auto">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors"
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            onClick={() => {
              setScore(0);
              resetBall(window.innerWidth, window.innerHeight);
            }}
            className="p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors"
          >
            <RotateCcw size={20} />
          </button>
          <button
            onClick={() => setBallColor(ballColor === BALL_COLOR ? CYAN_COLOR : BALL_COLOR)}
            className="p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {!isPlaying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none"
          >
            <div className="text-center pointer-events-auto">
              <h1 className="text-5xl font-bold text-white mb-4 tracking-tighter italic serif">CAT CATCH BALL</h1>
              <p className="text-white/60 mb-8 max-w-xs mx-auto">Designed for feline eyes. High contrast, unpredictable movement, and sensory feedback.</p>
              <button
                onClick={() => setIsPlaying(true)}
                className="px-8 py-4 bg-[#ffff00] text-black font-bold rounded-full hover:scale-105 transition-transform flex items-center gap-2 mx-auto"
              >
                <Play size={24} fill="currentColor" />
                START HUNT
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Instructions for human */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/20 text-[10px] uppercase tracking-[0.2em] pointer-events-none">
        Place on floor • Full screen recommended • Watch your cat hunt
      </div>
    </div>
  );
}
