#!/usr/bin/env python3
"""
Bande-son de « Une journée catastrophique… mais pas inutile » (80 s).

- Voix off : public/journee/voix-off.mp3 (ElevenLabs, « Paul K »), découpée en
  phrases et replacée sur la timeline (src/journee/timeline.json).
- Musique : synthétisée ici (numpy) et calée sur les mêmes événements :
  légère et humoristique (pizzicati, basson, glockenspiel) → mélancolique
  sous la pluie (piano, cordes) → douce et émotionnelle à la fin.
- Bruitages : réveil, chute, café renversé, pluie, tonnerre, bus, pas…
- Mix : ducking de la musique sous la voix, réverbération, normalisation.

Usage : python3 scripts/bande_son.py   (→ public/journee/bande-son.wav)
Dépendances : numpy, soundfile, ffmpeg (décodage du mp3).
"""
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "src/journee/timeline.json").read_text())
SR = 44100
DUR = float(TL["duration"])
N = int(DUR * SR)
EV = TL["ev"]
CY = TL["cycles"]
rng = np.random.default_rng(7)


# ───────────────────────── utilitaires ─────────────────────────
def T(n):
    return np.arange(n) / SR


def fft_filter(x, lo=None, hi=None, slope=1.0):
    """Filtre passe-bande doux dans le domaine fréquentiel."""
    n = len(x)
    if n < 8:
        return x
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** (2 * slope))
    if hi:
        g *= 1 / (1 + (f / hi) ** (2 * slope))
    return np.fft.irfft(X * g, n)


def noise(n):
    return rng.standard_normal(n)


def pink(n):
    X = np.fft.rfft(noise(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    X /= np.sqrt(np.maximum(f, 20))
    y = np.fft.irfft(X, n)
    return y / (np.abs(y).max() + 1e-9)


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na, endpoint=False) if na else e[:na]
    nd = min(nd, n - na)
    e[na:na + nd] = np.linspace(1, s, nd, endpoint=False) if nd else e[na:na + nd]
    nr = min(nr, n)
    if nr:
        e[n - nr:] *= np.linspace(1, 0, nr)
    return e


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def nm(s):
    """'C4', 'F#3', 'Bb2' → numéro MIDI."""
    base = NOTE[s[0]]
    i = 1
    if s[i] == "#":
        base += 1
        i += 1
    elif s[i] == "b":
        base -= 1
        i += 1
    return base + 12 * (int(s[i:]) + 1)


class Bus:
    """Bus stéréo."""

    def __init__(self):
        self.L = np.zeros(N + SR * 4)
        self.R = np.zeros(N + SR * 4)

    def add(self, x, t, gain=1.0, pan=0.0):
        i = int(round(t * SR))
        if i < 0:
            x = x[-i:]
            i = 0
        j = min(i + len(x), len(self.L))
        x = x[: j - i]
        a = (pan + 1) * np.pi / 4  # loi à puissance constante
        self.L[i:j] += x * gain * np.cos(a) * 1.4142
        self.R[i:j] += x * gain * np.sin(a) * 1.4142

    def add_st(self, l, r, t, gain=1.0):
        i = int(round(t * SR))
        j = min(i + len(l), len(self.L))
        self.L[i:j] += l[: j - i] * gain
        self.R[i:j] += r[: j - i] * gain

    def arr(self):
        return np.stack([self.L[:N], self.R[:N]])


def reverb_ir(rt60=2.4, predelay=0.02, damp=5000, seed=1):
    r = np.random.default_rng(seed)
    n = int(rt60 * SR)
    t = T(n)
    env = np.exp(-6.9 * t / rt60)
    out = []
    for _ in range(2):
        x = r.standard_normal(n) * env
        x = fft_filter(x, lo=120, hi=damp)
        x = np.concatenate([np.zeros(int(predelay * SR)), x])
        out.append(x / np.sqrt((x ** 2).sum()))
    return out


def convolve(x, h):
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[: len(x)]
    return y


def add_reverb(st, wet=0.25, rt60=2.4, damp=5000):
    irL, irR = reverb_ir(rt60, damp=damp)
    mono = st.mean(axis=0)
    wl = convolve(mono, irL)
    wr = convolve(mono, irR)
    return st + wet * np.stack([wl, wr])


# ───────────────────────── instruments ─────────────────────────
def piano(m, dur, vel=0.5, bright=1.0):
    f = midi(m)
    rel = 1.2
    n = int((dur + rel) * SR)
    t = T(n)
    y = np.zeros(n)
    for k in range(1, 11):
        fk = f * k * np.sqrt(1 + 0.00035 * k * k)
        if fk > 9000:
            break
        amp = (1 / k ** (1.7 - 0.4 * bright))
        dec = (0.55 + 0.9 * k) * (0.6 + f / 900)
        y += amp * np.exp(-t * dec) * np.sin(2 * np.pi * fk * t + k * 0.7)
    # feutre : attaque douce + relâchement à la fin de la durée tenue
    env = np.minimum(1, t / 0.004)
    off = int(dur * SR)
    env[off:] *= np.exp(-(t[off:] - dur) * 6)
    y *= env
    hammer = fft_filter(noise(int(0.012 * SR)), lo=800, hi=4000) * 0.02
    y[: len(hammer)] += hammer
    return y * vel * 0.5


def pluck(m, dur=0.6, vel=0.5, decay=0.993, bright=0.5):
    """Pizzicato (Karplus-Strong vectorisé par blocs)."""
    f = midi(m)
    P = max(2, int(round(SR / f)))
    n = int(dur * SR)
    tot = n + P + 1
    y = np.zeros(tot)
    exc = noise(P + 1)
    exc = fft_filter(exc, hi=1500 + 4000 * bright)
    y[: P + 1] = exc / (np.abs(exc).max() + 1e-9)
    s = P + 1
    while s < tot:
        e = min(s + P, tot)
        y[s:e] = decay * 0.5 * (y[s - P:e - P] + y[s - P - 1:e - P - 1])
        s = e
    y = y[P + 1:]
    t = T(len(y))
    y *= np.exp(-t * 5.5) * np.minimum(1, t / 0.002)
    y[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    return fft_filter(y, lo=60, hi=3200) * vel


def bassoon(m, dur, vel=0.5, glide=0.0, vib=0.0, bright=1.0):
    """Anche double « comique » ; glide en demi-tons sur la durée."""
    n = int((dur + 0.08) * SR)
    t = T(n)
    semis = m + glide * np.clip(t / max(dur, 1e-3), 0, 1)
    f = midi(0) * 2 ** (semis / 12) * (1 + vib * np.sin(2 * np.pi * 5.5 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    amps = [1, 0.75, 0.5, 0.42, 0.25, 0.18, 0.1, 0.07, 0.05]
    y = sum(a * (bright ** i) * np.sin((i + 1) * ph) for i, a in enumerate(amps))
    env = adsr(n, a=0.03, d=0.08, s=0.8, r=0.08)
    return fft_filter(y * env, hi=2200) * vel * 0.35


def glock(m, dur=1.2, vel=0.4):
    f = midi(m)
    n = int(dur * SR)
    t = T(n)
    y = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)
         + 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 10))
    y *= np.exp(-t * 2.6) * np.minimum(1, t / 0.001)
    return y * vel * 0.35


def strings(m, dur, vel=0.4, att=1.2, rel=1.8, cutoff=2600, voices=4):
    n = int((dur + rel) * SR)
    t = T(n)
    f0 = midi(m)
    y = np.zeros(n)
    det = np.linspace(-0.006, 0.006, voices)
    kmax = max(1, int(cutoff / f0))
    for v, d in enumerate(det):
        vib = 1 + 0.0025 * np.sin(2 * np.pi * (4.6 + 0.4 * v) * t + v)
        ph = 2 * np.pi * np.cumsum(np.full(n, f0 * (1 + d)) * vib) / SR + v * 1.3
        for k in range(1, kmax + 1):
            y += np.sin(k * ph) / k * (1 / (1 + (k * f0 / cutoff) ** 2))
    env = np.minimum(1, t / att) ** 1.5
    off = int(dur * SR)
    env[off:] *= np.exp(-(t[off:] - dur) * (4.0 / rel))
    return y * env * vel * 0.08


def sub(m, dur, vel=0.4, att=0.4, rel=1.2):
    n = int((dur + rel) * SR)
    t = T(n)
    f = midi(m)
    y = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    env = np.minimum(1, t / att)
    off = int(dur * SR)
    env[off:] *= np.exp(-(t[off:] - dur) * (4.0 / rel))
    return y * env * vel * 0.5


def tuba(m, dur=0.22, vel=0.5):
    n = int((dur + 0.05) * SR)
    t = T(n)
    f = midi(m)
    y = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) + 0.25 * np.sin(6 * np.pi * f * t)
    env = np.minimum(1, t / 0.012) * np.exp(-t * 7)
    return fft_filter(y * env, hi=1200) * vel * 0.5


def chord_notes(name):
    table = {
        "C": ["C3", "G3", "C4", "E4"], "Cadd9": ["C3", "G3", "D4", "E4"],
        "Am": ["A2", "E3", "A3", "C4"], "F": ["F2", "C3", "A3", "C4"],
        "G": ["G2", "D3", "B3", "D4"], "Dm": ["D3", "A3", "D4", "F4"],
        "E": ["E2", "B2", "G#3", "B3"], "Esus": ["E2", "B2", "A3", "B3"],
        "Fmaj7": ["F2", "C3", "E3", "A3"], "Am7": ["A2", "E3", "G3", "C4"],
        "G/B": ["B2", "D3", "G3", "D4"], "C/E": ["E2", "G3", "C4", "E4"],
        "Gsus": ["G2", "D3", "C4", "D4"],
    }
    return [nm(x) for x in table[name]]


# ───────────────────────── musique ─────────────────────────
mus = Bus()
BEAT = 0.5  # 120 bpm : la foulée de course (0,5 s) tombe sur le temps


def seq(bus, start, notes, inst, gain=1.0, pan=0.0, **kw):
    """notes : liste (beat, midi|nom, durée_beats, vel)."""
    for b, n_, d, v in notes:
        m = nm(n_) if isinstance(n_, str) else n_
        bus.add(inst(m, d * BEAT, vel=v, **kw), start + b * BEAT, gain, pan)


# — Ouverture (0 → 1,2) : aube, accord suspendu très doux
for m_ in chord_notes("Cadd9")[1:]:
    mus.add(strings(m_ + 12, 2.0, vel=0.25, att=0.8, rel=1.0), 0.0, 0.8)
mus.add(glock(nm("E6"), 1.5, 0.25), 0.35, 0.6, 0.3)
mus.add(glock(nm("G6"), 1.5, 0.22), 0.85, 0.6, -0.3)

# — Répétition (snooze → avance rapide) : motif pizzicato espiègle
t0 = 3.3
motif = [(0, "G4", 0.5, 0.5), (0.5, "E4", 0.5, 0.4), (1, "G4", 0.5, 0.5), (1.5, "C5", 0.5, 0.55),
         (2, "B4", 0.5, 0.4), (2.5, "G4", 0.5, 0.4), (3, "A4", 1, 0.45)]
seq(mus, t0, motif, pluck, 0.7, 0.15)
# avance rapide : gamme ascendante qui accélère (time-lapse)
ff0, ff1 = EV["ff"]
scale_ = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6"]
k = len(scale_)
for i, s in enumerate(scale_):
    u = i / (k - 1)
    tt = ff0 + (ff1 - ff0) * (1 - (1 - u) ** 1.8)
    mus.add(pluck(nm(s), 0.4, 0.38), tt, 0.7, -0.2 + 0.4 * u)
    mus.add(glock(nm(s) + 12, 0.6, 0.15), tt, 0.4)

# — Réveil en sursaut : « stab » comique (le réveil n°2 sonne seul avant)
w = EV["wake"]
for m_ in ["C3", "G3", "E4", "C5"]:
    mus.add(pluck(nm(m_), 0.5, 0.7), w + 0.02, 0.8)
mus.add(bassoon(nm("C3"), 0.25, 0.8), w + 0.02, 0.9)

# — Groove panique (7,2 → 8,7) : basse tuba + pizz à contretemps
g0 = 7.25
bassline = ["C3", "G2", "C3", "G2", "A2", "E2"]
for i, b in enumerate(bassline):
    mus.add(tuba(nm(b), 0.2, 0.55), g0 + i * 0.25 * 1, 0.8)
for i in range(6):
    for m_ in ["E4", "G4"]:
        mus.add(pluck(nm(m_), 0.25, 0.25), g0 + 0.125 + i * 0.25, 0.55, 0.2)

# trébuche : sifflet descendant, puis silence à l'impact, puis « wah wah waaah »
tr, im = EV["trip"], EV["impact"]
mus.add(bassoon(nm("G4"), im - tr, 0.5, glide=-12, bright=0.7), tr, 0.7)
wah = [("E3", 0.55, 0), ("Eb3", 0.55, 0), ("D3", 1.4, -1.0)]
tt = 9.75
for n_, d, gl in wah:
    mus.add(bassoon(nm(n_), d, 0.6, glide=gl, vib=0.012 if d > 1 else 0.0), tt, 0.85)
    tt += d + 0.05

# — Rue (12,6 → 16,5) : course sur le tempo
r0, r1 = EV["runA"]
melA = [(0, "C5", 0.5, 0.5), (0.5, "B4", 0.5, 0.4), (1, "A4", 0.5, 0.45), (1.5, "G4", 0.5, 0.4),
        (2, "E4", 0.5, 0.45), (2.5, "G4", 0.5, 0.4), (3, "C5", 1, 0.5),
        (4, "D5", 0.5, 0.5), (4.5, "C5", 0.5, 0.4)]
seq(mus, r0 + 0.1, melA, pluck, 0.75, 0.2)
bassA = ["C3", "G2", "A2", "E2", "F2", "C3", "G2", "G2", "C3"]
for i, b in enumerate(bassA):
    mus.add(tuba(nm(b), 0.2, 0.55), r0 + 0.1 + i * BEAT, 0.8)
    for m_ in ["E4", "G4", "C5"]:
        mus.add(pluck(nm(m_), 0.2, 0.18), r0 + 0.1 + i * BEAT + 0.25, 0.5, -0.2)
mus.add(glock(nm("C6"), 0.8, 0.3), r0 + 0.1, 0.5)
# arrêt au feu rouge : petites notes répétées impatientes
j0, j1 = EV["jog"]
tt = j0
i = 0
while tt < j1 - 0.05:
    mus.add(pluck(nm("G4" if i % 2 == 0 else "F#4"), 0.15, 0.3), tt, 0.6, 0.1)
    tt += 0.18
    i += 1
# feu vert : petite montée
for i, s in enumerate(["C5", "E5", "G5"]):
    mus.add(pluck(nm(s), 0.25, 0.4), EV["green"] + i * 0.06, 0.6)
# assombrissement : nappe dissonante qui monte jusqu'au tonnerre
d0, d1 = EV["darken"]
for m_ in ["A2", "Bb2", "E3"]:
    mus.add(strings(nm(m_), d1 - d0 + 0.3, vel=0.35, att=0.6, rel=0.6, cutoff=1500), d0, 0.6)

# — Section mélancolique (18,4 → 56,95) : piano + cordes, la mineur
prog_ = [(18.4, "Am"), (22.4, "F"), (26.4, "C"), (30.4, "G"), (34.4, "Am"), (38.4, "F"),
         (42.4, "Dm"), (45.6, "Esus"), (47.6, "E"), (49.6, "F"), (53.0, "Gsus"), (55.2, "G")]
ends = [p[0] for p in prog_[1:]] + [56.95]
for (ts, ch), te in zip(prog_, ends):
    notes = chord_notes(ch)
    L = te - ts
    # cordes tenues (très douces)
    for m_ in notes[1:]:
        mus.add(strings(m_, L, vel=0.3, att=1.4, rel=1.6, cutoff=2000), ts, 0.55, rng.uniform(-0.3, 0.3))
    mus.add(sub(notes[0], L, vel=0.35), ts, 0.6)
    # arpège de piano (croches lentes, 0,5 s)
    arp = notes[1:] + [notes[2] + 12, notes[3] + 12 if ch not in ("E", "Esus") else notes[3]]
    pattern = [0, 1, 2, 3, 4, 3, 2, 1]
    step = 0.5
    k = 0
    tt = ts
    while tt < te - 0.2:
        idx = pattern[k % len(pattern)]
        mus.add(piano(arp[idx] + 12, 0.45, vel=0.28 if k % 4 else 0.36), tt, 0.7, -0.15 + 0.3 * (idx / 4))
        tt += step
        k += 1
# mélodie de piano qui apparaît avec la rencontre (espoir timide)
mel = [(38.6, "E5", 1.4), (40.2, "C5", 1.0), (41.4, "A4", 1.6), (43.4, "F5", 1.0), (44.6, "E5", 1.0),
       (46.0, "D5", 1.4), (47.8, "B4", 1.6), (49.8, "C5", 1.0), (50.9, "F5", 1.4), (52.6, "E5", 1.0),
       (53.8, "D5", 1.0), (55.0, "G5", 1.6)]
for ts, n_, d in mel:
    mus.add(piano(nm(n_), d, vel=0.42, bright=1.2), ts, 0.75, 0.1)

# — « quelque chose change » : scintillement + passage en do majeur lumineux
sb = EV["sunBurst"]
for i, s in enumerate(["C5", "E5", "G5", "C6", "E6", "G6", "C7"]):
    mus.add(glock(nm(s), 1.6, 0.32), sb - 0.45 + i * 0.075, 0.7, -0.4 + i * 0.13)
riser = fft_filter(noise(int(1.2 * SR)), lo=2000, hi=9000) * np.linspace(0, 1, int(1.2 * SR)) ** 2
mus.add(riser * 0.05, sb - 1.15, 1.0)

progC = [(56.95, "Cadd9"), (60.55, "G/B"), (64.15, "Am7"), (67.5, "Fmaj7"), (71.1, "C/E"),
         (75.0, "F"), (77.0, "G"), (78.4, "C")]
endsC = [p[0] for p in progC[1:]] + [80.6]
for (ts, ch), te in zip(progC, endsC):
    notes = chord_notes(ch)
    L = te - ts
    for m_ in notes[1:]:
        mus.add(strings(m_ + 12, L, vel=0.36, att=1.0, rel=1.4, cutoff=3000), ts, 0.62, rng.uniform(-0.35, 0.35))
        mus.add(strings(m_, L, vel=0.3, att=1.3, rel=1.4, cutoff=2200), ts, 0.5)
    mus.add(sub(notes[0], L, vel=0.38), ts, 0.65)
    arp = notes[1:] + [notes[1] + 12, notes[2] + 12, notes[3] + 12]
    pattern = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]
    tt = ts
    k = 0
    while tt < te - 0.15:
        idx = pattern[k % len(pattern)]
        mus.add(piano(arp[idx] + 12, 0.5, vel=0.25 if k % 5 else 0.33), tt, 0.7, -0.25 + 0.5 * idx / 5)
        tt += 0.3
        k += 1
melC = [(57.4, "G5", 1.4), (59.0, "E5", 1.0), (60.6, "D5", 2.0), (63.0, "B4", 1.0), (64.2, "C5", 2.4),
        (67.6, "A5", 1.6), (69.4, "G5", 1.2), (71.2, "E5", 1.6), (73.0, "G5", 1.6), (75.05, "A5", 1.8),
        (77.05, "B5", 1.2), (78.45, "C6", 2.2)]
for ts, n_, d in melC:
    mus.add(piano(nm(n_), d, vel=0.45, bright=1.2), ts, 0.8, 0.12)
mus.add(glock(nm("C6"), 2.0, 0.3), 75.0, 0.6, 0.2)
mus.add(glock(nm("G6"), 2.0, 0.22), 75.2, 0.6, -0.2)
mus.add(glock(nm("E6"), 2.4, 0.25), 78.45, 0.6, 0.0)

music = add_reverb(mus.arr(), wet=0.32, rt60=2.6, damp=5500)


# ───────────────────────── bruitages ─────────────────────────
fx = Bus()


def env_exp(n, tau):
    return np.exp(-T(n) / tau)


def thump(freq=80, dur=0.25, vel=1.0, drop=0.5):
    n = int(dur * SR)
    t = T(n)
    f = freq * (1 + drop * np.exp(-t * 30))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (5 / dur))
    click = fft_filter(noise(n), lo=200, hi=3000) * np.exp(-t * 90) * 0.5
    return (y + click) * vel


def beep(freq, dur, vel=0.3):
    n = int(dur * SR)
    t = T(n)
    y = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(6 * np.pi * freq * t) + 0.12 * np.sin(10 * np.pi * freq * t)
    e = np.minimum(1, t / 0.004) * np.minimum(1, (dur - t) / 0.004)
    return y * e * vel


def alarm(t0, t1, vel=0.22, pan=0.45, fast=False):
    tt = t0
    while tt < t1:
        for i in range(4):
            if tt + i * 0.13 < t1:
                fx.add(beep(2050, 0.075, vel), tt + i * 0.13, 1.0, pan)
        tt += 0.85 if not fast else 0.7


def whoosh(dur=0.45, vel=0.25, lo=300, hi=4000, rise=True):
    n = int(dur * SR)
    t = T(n)
    x = pink(n)
    u = t / dur
    e = np.sin(np.pi * u) ** 1.5 if rise else np.exp(-t * 6)
    return fft_filter(x, lo=lo, hi=hi) * e * vel


def step(kind="concrete", vel=0.3):
    n = int(0.16 * SR)
    t = T(n)
    low = np.sin(2 * np.pi * 95 * t) * np.exp(-t * 55)
    hi = fft_filter(noise(n), lo=600 if kind != "wood" else 300, hi=6000) * np.exp(-t * 70)
    y = 0.8 * low + 0.6 * hi
    if kind == "wood":
        y += 0.6 * np.sin(2 * np.pi * 240 * t) * np.exp(-t * 45)
    if kind == "wet":
        m = int(0.22 * SR)
        sp = fft_filter(noise(m), lo=900, hi=7000) * np.exp(-T(m) * 22) * 0.7
        z = np.zeros(m)
        z[:n] += y
        y = z + sp
    return y * vel


def steps(t0, t1, period, kind, vel=0.3, pan=0.0, phase=0.25):
    k = 0
    while True:
        tt = t0 + period * (phase + 0.5 * k)
        if tt > t1:
            break
        fx.add(step(kind, vel * rng.uniform(0.8, 1.1)), tt, 1.0, pan + rng.uniform(-0.05, 0.05))
        k += 1


def boing(t0, vel=0.25):
    n = int(0.45 * SR)
    t = T(n)
    f = 180 + 700 * (1 - np.exp(-t * 9))
    f *= 1 + 0.08 * np.sin(2 * np.pi * 22 * t) * np.exp(-t * 4)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5)
    fx.add(y * vel, t0, 1.0)


def creak(t0, vel=0.12, f0=520, f1=760, dur=0.3, pan=0.0):
    n = int(dur * SR)
    t = T(n)
    f = np.linspace(f0, f1, n) * (1 + 0.02 * np.sin(2 * np.pi * 37 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph)) * np.sin(np.pi * t / dur)
    y *= 0.6 + 0.4 * (np.sin(2 * np.pi * 61 * t) > 0)
    fx.add(fft_filter(y, lo=300, hi=3000) * vel, t0, 1.0, pan)


def metal_bong(t0, vel=0.4, pan=0.1):
    n = int(1.4 * SR)
    t = T(n)
    y = np.zeros(n)
    for f, a, d in [(310, 1, 2.6), (842, 0.6, 3.5), (1467, 0.4, 5), (2290, 0.25, 7), (3180, 0.15, 9)]:
        y += a * np.sin(2 * np.pi * f * t) * np.exp(-t * d)
    th = thump(70, 0.2, 0.6)
    y[: len(th)] += th
    fx.add(y * vel * 0.5, t0, 1.0, pan)


def splash(t0, vel=0.35, dur=0.5, pan=0.0):
    n = int(dur * SR)
    t = T(n)
    y = fft_filter(noise(n), lo=500, hi=4500) * (np.minimum(1, t / 0.008) * np.exp(-t * 9))
    fx.add(y * vel, t0, 1.0, pan)
    for _ in range(12):  # gouttes
        dt = rng.uniform(0.05, 0.6)
        m = int(0.03 * SR)
        f = rng.uniform(900, 2200)
        tt = T(m)
        d = np.sin(2 * np.pi * f * (1 + 2 * tt) * tt) * np.exp(-tt * 140)
        fx.add(d * vel * 0.25, t0 + dt, 1.0, pan + rng.uniform(-0.3, 0.3))


def thunder(t0, vel=0.6, dur=4.0):
    n = int(dur * SR)
    t = T(n)
    crack = fft_filter(noise(n), lo=800, hi=8000) * np.exp(-t * 18) * 0.5
    rum = fft_filter(noise(n), lo=25, hi=180) * 2.5
    mod = 0.55 + 0.45 * np.sin(2 * np.pi * 1.3 * t + 1) * np.sin(2 * np.pi * 0.7 * t)
    rum *= np.minimum(1, t / 0.12) * np.exp(-t * 0.9) * mod
    y = crack + rum
    l = y + 0.3 * np.roll(y, 211)
    r = y + 0.3 * np.roll(y, 397)
    fx.add_st(l * vel, r * vel, t0)


def paper_rip(t0, vel=0.3):
    n = int(0.35 * SR)
    t = T(n)
    x = noise(n) * (rng.random(n) < 0.25)
    y = fft_filter(x, lo=1200, hi=7000) * np.sin(np.pi * t / 0.35)
    fx.add(y * vel, t0, 1.0, 0.25)


def rustle(t0, vel=0.12, dur=0.35, pan=0.0):
    n = int(dur * SR)
    t = T(n)
    x = noise(n) * (0.5 + 0.5 * (rng.random(n) < 0.4))
    y = fft_filter(x, lo=1500, hi=8000) * np.sin(np.pi * t / dur) ** 2
    fx.add(y * vel, t0, 1.0, pan)


def chirp(t0, vel=0.06, pan=0.0):
    for i in range(rng.integers(2, 5)):
        n = int(0.07 * SR)
        t = T(n)
        f0 = rng.uniform(3000, 4200)
        f = f0 + rng.uniform(-1500, 1500) * t / 0.07
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.07)
        fx.add(y * vel, t0 + i * 0.09, 1.0, pan)


# — Chambre
a0, a1 = EV["alarm1"]
alarm(a0, a1, 0.2)
fx.add(thump(150, 0.08, 0.6), EV["snooze"], 1.0, 0.4)
fx.add(beep(4000, 0.02, 0.12), EV["snooze"] + 0.03, 1.0, 0.4)
for ts in (3.55, 4.75):  # ronflements doux
    n = int(0.9 * SR)
    t = T(n)
    sn = fft_filter(noise(n), lo=80, hi=600) * np.sin(np.pi * t / 0.9) ** 2 * (1 + 0.6 * np.sin(2 * np.pi * 28 * t))
    fx.add(sn * 0.08, ts, 1.0, 0.2)
# tic-tac qui accélère pendant l'avance rapide
ff0, ff1 = EV["ff"]
tt = ff0
gap = 0.22
while tt < ff1:
    fx.add(beep(3200, 0.01, 0.07), tt, 1.0, 0.45)
    tt += gap
    gap = max(0.035, gap * 0.86)
fx.add(whoosh(ff1 - ff0, 0.08, 800, 6000), ff0, 1.0)
alarm(EV["alarm2"][0], EV["alarm2"][1], 0.3, fast=True)
boing(EV["wake"], 0.22)
creak(EV["jumpOff"] - 0.05, 0.1)
fx.add(whoosh(0.3, 0.12), EV["jumpOff"])
fx.add(step("wood", 0.45), EV["jumpOff"] + 0.2)
steps(EV["run1"][0], EV["run1"][1] - 0.05, CY["run1"], "wood", 0.35, -0.1)
fx.add(whoosh(0.4, 0.22, 400, 5000), EV["trip"])
fx.add(thump(55, 0.5, 1.0, 0.8), EV["impact"])
fx.add(thump(180, 0.12, 0.35), EV["impact"] + 0.02, 1.0, -0.3)
for i in range(4):  # objets qui sautent sur le parquet
    fx.add(thump(rng.uniform(300, 600), 0.06, 0.12), EV["impact"] + 0.08 + i * rng.uniform(0.05, 0.09), 1.0, rng.uniform(-0.4, 0.4))
fx.add(thump(220, 0.1, 0.3), EV["shoeLand"], 1.0, -0.2)
fx.add(whoosh(0.4, 0.2, 500, 7000), EV["whip1"])

# — Rue
ra0 = TL["scenes"]["rue"][0]
amb_n = int((EV["rainStart"] + 2 - ra0) * SR)
city = fft_filter(pink(amb_n), lo=40, hi=500) * 0.06
city *= np.minimum(1, T(amb_n) / 0.4) * np.minimum(1, (amb_n / SR - T(amb_n)) / 1.5)
fx.add(city, ra0, 1.0)
for ts in (12.9, 13.8, 14.6):
    chirp(ts, 0.04, rng.uniform(-0.6, 0.6))
steps(EV["runA"][0], EV["runA"][1], CY["runA"], "concrete", 0.32)
n = int(0.4 * SR)
t = T(n)
sq = np.sin(2 * np.pi * np.cumsum(1300 + 200 * np.sin(2 * np.pi * 31 * t)) / SR) * np.exp(-t * 6)
fx.add(sq * 0.06 + whoosh(0.4, 0.1, 1000, 6000, rise=False), EV["skid"])
tt = EV["skid"]
while tt < EV["green"]:  # décompte sonore du feu piéton
    fx.add(beep(880, 0.03, 0.06), tt + 0.1, 1.0, 0.3)
    tt += 0.5
fx.add(beep(1320, 0.12, 0.08), EV["green"], 1.0, 0.3)
steps(EV["jog"][0], EV["jog"][1], CY["jog"], "concrete", 0.18)
steps(EV["dash"][0], EV["dash"][1], CY["dash"], "concrete", 0.35, phase=0.1)
metal_bong(EV["bonk"], 0.55)
splash(EV["splash"], 0.4)
fx.add(thump(420, 0.12, 0.25), EV["cupLand"], 1.0, -0.2)
fx.add(thump(380, 0.08, 0.15), EV["cupLand"] + 0.18, 1.0, -0.25)
thunder(EV["thunder"], 0.55)
thunder(23.0, 0.25, 3.5)
fx.add(whoosh(0.45, 0.22, 500, 7000), EV["whip2"])

# — Pluie (continue de 18 s à ~57,9 s)
rs = EV["rainStart"]
re0, re1 = EV["rainStop"]
rn = int((re1 - rs + 0.5) * SR)
rt = T(rn)
rainL = fft_filter(pink(rn), lo=400, hi=9000) * 0.5 + fft_filter(noise(rn), lo=3000, hi=12000) * 0.05
rainR = fft_filter(pink(rn), lo=400, hi=9000) * 0.5 + fft_filter(noise(rn), lo=3000, hi=12000) * 0.05
drops = np.zeros(rn)
idx = rng.integers(0, rn - 400, int(rn / SR * 70))
for i_ in idx:
    m = int(rng.uniform(0.004, 0.012) * SR)
    drops[i_:i_ + m] += rng.uniform(-1, 1) * np.exp(-np.arange(m) / (m / 4))
drops = fft_filter(drops, lo=1500, hi=9000) * 0.35
renv = np.clip((rt) / 1.6, 0, 1) ** 1.5
renv *= np.clip((re1 - rs - rt) / (re1 - re0), 0, 1) ** 1.2
# un peu plus présente sous l'abri (tambourinement sur le toit)
roof = fft_filter(pink(rn), lo=150, hi=1200) * 0.4
roof_env = np.clip((rt - (EV["sit"] - 1.5 - rs)) / 2, 0, 1)
fx.add_st((rainL + drops + roof * roof_env) * renv * 0.32, (rainR + np.roll(drops, 1931) + roof * roof_env) * renv * 0.32, rs)

# — Arrêt de bus
b0 = TL["scenes"]["arret"][0]
bn = int(5.5 * SR)
bt = T(bn)
dep = EV["busDepart"] - b0
fr = 42 + 30 * np.clip((bt - dep) / 2.5, 0, 1) ** 0.7
ph = 2 * np.pi * np.cumsum(fr) / SR
eng = sum(a * np.sin(k * ph) for k, a in [(1, 1), (2, 0.6), (3, 0.45), (4, 0.3), (6, 0.15)])
eng *= 1 + 0.25 * np.sin(2 * np.pi * 9 * bt)
eng = fft_filter(eng, hi=900) * 0.18
eng *= np.minimum(1, bt / 0.25) * np.clip(1 - (bt - dep - 1.2) / 3.0, 0, 1)
tires = fft_filter(pink(bn), lo=300, hi=3000) * np.clip((bt - dep) / 0.8, 0, 1) * np.clip(1 - (bt - dep - 1.0) / 3.0, 0, 1) * 0.12
busL = (eng + tires) * np.clip(1 - np.clip((bt - dep) / 4, 0, 1) * 0.7, 0, 1)
busR = (eng + tires) * np.clip(0.6 + np.clip((bt - dep) / 3, 0, 0.4), 0, 1)
fx.add_st(busL, busR, b0)
hiss_n = int(0.7 * SR)
hiss = fft_filter(noise(hiss_n), lo=2500, hi=10000) * np.exp(-T(hiss_n) * 5) * 0.2
fx.add(hiss, EV["busDoors"], 1.0, 0.35)
fx.add(thump(130, 0.15, 0.4), EV["busDoors"] + 0.4, 1.0, 0.35)
steps(EV["run3"][0], EV["run3"][1], CY["run3"], "wet", 0.32, -0.2)
splash(EV["heroStop"], 0.15, 0.35)
steps(EV["walkBench"][0], EV["walkBench"][1], CY["walkBench"], "wet", 0.25)
creak(EV["sit"], 0.08, 380, 300, 0.4)
fx.add(thump(110, 0.15, 0.35), EV["sit"])

# — Rencontre
steps(EV["oldWalk"][0], EV["oldWalk"][1], CY["oldWalk"], "wet", 0.18, 0.4)
paper_rip(EV["rip"], 0.3)
of0, of1 = EV["orangesFall"]
for i, dt in enumerate([0.0, 0.12, 0.25, 0.33, 0.5, 0.66]):
    fx.add(thump(rng.uniform(160, 230), 0.12, 0.3), of0 + dt, 1.0, 0.35 - i * 0.05)
    fx.add(thump(rng.uniform(170, 240), 0.08, 0.12), of0 + dt + 0.18, 1.0, 0.3 - i * 0.05)
roll_n = int((EV["orangeArrive"] - of1) * SR)
roll = fft_filter(noise(roll_n), lo=100, hi=900) * (0.5 + 0.5 * np.sin(2 * np.pi * 11 * T(roll_n))) * np.linspace(1, 0.2, roll_n) * 0.08
fx.add(roll, of1, 1.0, 0.1)
fx.add(thump(260, 0.06, 0.15), EV["orangeArrive"], 1.0, -0.1)
creak(EV["heroStand"], 0.07, 300, 420, 0.3)
steps(EV["walkAway"][0], EV["walkAway"][1], CY["walkAway"], "wet", 0.22, -0.25)
rustle(EV["turn"], 0.1, 0.3)
steps(EV["walkBack"][0], EV["walkBack"][1], CY["walkBack"], "wet", 0.22, 0.0)
rustle(EV["kneel"], 0.1, 0.4)
for ts in (48.9, 49.55, 50.2, 50.85):
    rustle(ts, 0.14, 0.3, 0.15)
    fx.add(thump(250, 0.05, 0.08), ts + 0.1, 1.0, 0.15)
rustle(EV["standUp"], 0.08, 0.4)
fx.add(whoosh(0.5, 0.08, 300, 3000), EV["offer"])
rustle(EV["take"], 0.1, 0.3)

# — Final : oiseaux, pas tranquilles
for ts in np.arange(57.6, 79.5, 1.35):
    chirp(ts + rng.uniform(0, 0.6), 0.035, rng.uniform(-0.7, 0.7))
steps(EV["walk6"][0], 68.0, CY["walk6"], "concrete", 0.12)

sfx = add_reverb(fx.arr(), wet=0.12, rt60=1.2, damp=6000)


# ───────────────────────── voix off ─────────────────────────
raw = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", str(ROOT / "public" / TL["voiceFile"]), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
    check=True, capture_output=True).stdout
vsrc = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
vo = np.zeros(N + SR)
for c in TL["voice"]:
    a, b = c["src"]
    seg = vsrc[int(a * SR):int(b * SR)].copy()
    fade = int(0.012 * SR)
    seg[:fade] *= np.linspace(0, 1, fade)
    seg[-fade:] *= np.linspace(1, 0, fade)
    i = int(round(c["at"] * SR))
    vo[i:i + len(seg)] += seg
vo = vo[:N]
vo *= 0.89 / (np.abs(vo).max() + 1e-9)
# légère présence : petite réverbération courte
vo_st = np.stack([vo, vo])
vo_st = add_reverb(vo_st, wet=0.05, rt60=0.7, damp=7000)

# ───────────────────────── mix ─────────────────────────
# enveloppe de la voix → ducking de la musique et (un peu) des ambiances
win = int(0.05 * SR)
envv = np.sqrt(np.convolve(vo ** 2, np.ones(win) / win, mode="same"))
envv = envv / (envv.max() + 1e-9)
att, rel = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.35 * SR))
# lissage asymétrique (approximé par blocs pour rester rapide)
blk = 256
nb = int(np.ceil(N / blk))
e_blk = np.array([envv[i * blk:(i + 1) * blk].max() for i in range(nb)])
sm = np.zeros(nb)
for i in range(1, nb):
    c = att ** blk if e_blk[i] > sm[i - 1] else rel ** blk
    sm[i] = c * sm[i - 1] + (1 - c) * e_blk[i]
duck = np.repeat(sm, blk)[:N]
duck = np.clip(duck * 3.0, 0, 1)
music_gain = 0.42 * (1 - 0.5 * duck)
sfx_gain = 1.0 * (1 - 0.25 * duck)
# fin : fondu général
t_all = T(N)
fo0, fo1 = EV["fadeOut"]
master_env = np.clip((fo1 - t_all) / (fo1 - fo0), 0, 1) ** 1.3
master_env *= np.clip(t_all / 0.25, 0, 1)

mixL = vo_st[0][:N] * 1.0 + music[0][:N] * music_gain + sfx[0][:N] * sfx_gain
mixR = vo_st[1][:N] * 1.0 + music[1][:N] * music_gain + sfx[1][:N] * sfx_gain
mix = np.stack([mixL, mixR]) * master_env

# normalisation vers ~ -16 LUFS (approx. RMS pondéré) + limiteur doux
rms = np.sqrt(np.mean(mix ** 2))
target_rms = 10 ** (-19.0 / 20)
mix *= target_rms / (rms + 1e-9)
thr, ceil = 0.75, 0.89  # plafond ≈ -1 dBFS
over = np.abs(mix) > thr
mix[over] = np.sign(mix[over]) * (thr + (ceil - thr) * np.tanh((np.abs(mix[over]) - thr) / (ceil - thr)))

out = ROOT / "public/journee/bande-son.wav"
sf.write(out, mix.T.astype(np.float32), SR, subtype="PCM_16")
print("écrit :", out, f"{N / SR:.2f} s")
if os.environ.get("STEMS"):  # pistes séparées pour contrôle du mix
    d = Path(os.environ["STEMS"])
    d.mkdir(parents=True, exist_ok=True)
    sf.write(d / "voix.wav", vo_st[:, :N].T.astype(np.float32), SR)
    sf.write(d / "musique.wav", (music[:, :N] * music_gain).T.astype(np.float32), SR)
    sf.write(d / "bruitages.wav", (sfx[:, :N] * sfx_gain).T.astype(np.float32), SR)
