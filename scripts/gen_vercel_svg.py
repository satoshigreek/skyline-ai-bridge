#!/usr/bin/env python3
"""Generate a Vercel deployment / infrastructure diagram (SVG + PNG)."""
import html
import cairosvg

W, H = 1560, 1180
P = []


def esc(s):
    return html.escape(s, quote=True)


def rect(x, y, w, h, fill, stroke, rx=12, sw=2, dash=None, opacity=1.0):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    P.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" '
             f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d} opacity="{opacity}"/>')


def text(x, y, s, size=15, color="#fff", weight="normal", anchor="middle",
         family="Segoe UI, Helvetica, Arial, sans-serif", italic=False):
    st = ' font-style="italic"' if italic else ""
    P.append(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
             f'fill="{color}" font-weight="{weight}" text-anchor="{anchor}"{st}>{esc(s)}</text>')


def node(x, y, w, h, title, sub, fill, stroke, tcolor="#fff", scolor="#e8eef6",
         title_size=14.5, sub_size=11):
    rect(x, y, w, h, fill, stroke)
    cx = x + w / 2
    if sub:
        text(cx, y + h / 2 - 3, title, size=title_size, color=tcolor, weight="bold")
        for i, line in enumerate(sub.split("\n")):
            text(cx, y + h / 2 + 16 + i * 14, line, size=sub_size, color=scolor)
    else:
        text(cx, y + h / 2 + 5, title, size=title_size, color=tcolor, weight="bold")


def arrow(x1, y1, x2, y2, color="#5b6472", label=None, sw=2.2, lx=None, ly=None,
          dash=None, lcolor="#44505f", marker="arrow"):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    P.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
             f'stroke-width="{sw}" marker-end="url(#{marker})"{d}/>')
    if label:
        mx = lx if lx is not None else (x1 + x2) / 2
        my = ly if ly is not None else (y1 + y2) / 2
        tw = len(label) * 6.3 + 12
        rect(mx - tw / 2, my - 11, tw, 20, "#fff", "#d6dce4", rx=5, sw=1)
        text(mx, my + 3, label, size=11, color=lcolor, weight="bold")


# palette
C_DEV = ("#0b3d66", "#072a47")
C_GH = ("#2b3137", "#15191d")
C_VERCEL = ("#0a0a0a", "#000")
C_EDGE = ("#7c5cff", "#5b3fd6")
C_STATIC = ("#1168bd", "#0c4f90")
C_FN = ("#3a7bd5", "#2a5da8")
C_ENV = ("#2f9e6f", "#23764f")
C_EXT = ("#69707d", "#4b515c")
BG = "#f4f6f9"

P.append('<defs>'
         '<marker id="arrow" markerWidth="11" markerHeight="11" refX="9" refY="3.2" orient="auto" markerUnits="userSpaceOnUse">'
         '<path d="M0,0 L9,3.2 L0,6.4 Z" fill="#5b6472"/></marker>'
         '<marker id="arrowG" markerWidth="11" markerHeight="11" refX="9" refY="3.2" orient="auto" markerUnits="userSpaceOnUse">'
         '<path d="M0,0 L9,3.2 L0,6.4 Z" fill="#2f9e6f"/></marker>'
         '</defs>')
rect(0, 0, W, H, BG, BG, rx=0, sw=0)

# title
text(60, 46, "Skyline AI Bridge — Vercel Deployment / Infrastructure", size=26, color="#16202e", weight="bold", anchor="start")
text(60, 72, "git push to main  ->  Vercel auto-build (Next.js 15)  ->  Edge + Node serverless functions  ->  external rails. Env vars optional; app boots live on defaults.",
     size=13.5, color="#5b6472", anchor="start")

# --- top row: developer + github + pipeline ---
node(60, 110, 230, 74, "Developer", "git push -> main\n(or: vercel --prod)", C_DEV[0], C_DEV[1])
node(360, 110, 230, 74, "GitHub repo", "satoshigreek/\nskyline-ai-bridge", C_GH[0], C_GH[1])
node(660, 110, 260, 74, "Vercel Build", "auto-detect Next.js\nnext build  ->  .next", C_VERCEL[0], "#333")
arrow(290, 147, 360, 147, label="push")
arrow(590, 147, 660, 147, label="webhook", lcolor="#44505f")

# env vars panel (top right)
rect(980, 102, 520, 90, "#eaf7f0", "#aedcc6", rx=10, sw=1.5, dash="6 4")
text(1000, 124, "Environment Variables  (Production scope — all OPTIONAL)", size=12.5, color="#1f7a55", weight="bold", anchor="start")
text(1000, 145, "ANTHROPIC_API_KEY · ONECLICK_JWT · SKYLINE_API  (server-side secrets)", size=11, color="#3a6b54", anchor="start")
text(1000, 163, "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID · _SPEND_CAP_USD · _BAP3X_OFT_BASE", size=11, color="#3a6b54", anchor="start")
text(1000, 181, "Unset -> heuristic parser, on-chain-verified OFT defaults, 0.2% NEAR fee", size=10.5, color="#6b8a7a", anchor="start", italic=True)

# --- big Vercel platform box ---
VX, VY, VW, VH = 60, 230, 1000, 470
rect(VX, VY, VW, VH, "#f2f0ff", "#c4b8f5", rx=16, sw=2)
text(VX + 20, VY + 30, "Vercel  —  *.vercel.app  (e.g. bridge.odyssey-works.io)", size=16, color="#000", weight="bold", anchor="start")

# Edge / CDN
node(VX + 30, VY + 55, 250, 90, "Edge Network / CDN", "static assets + routing\nmiddleware.ts: CORS\nfor /api/* (GH Pages origin)", C_EDGE[0], C_EDGE[1], sub_size=10.5)

# Static frontend served
node(VX + 30, VY + 175, 250, 78, "Frontend (React 19)", "prebuilt client bundle\nRainbowKit / wagmi", C_STATIC[0], C_STATIC[1], sub_size=10.5)

# Serverless functions group
text(VX + 320, VY + 50, "Node Serverless Functions  (runtime: nodejs · 8 functions)", size=12.5, color="#2a5da8", weight="bold", anchor="start")
fns = [("/api/parse", "Claude / heuristic"), ("/api/execute", "Rail B + spend cap"),
       ("/api/quote", "live OFT / NEAR"), ("/api/status", "swap polling"),
       ("/api/tokens", "1-Click catalog"), ("/api/apex/create", "Rail C"),
       ("/api/apex/submit", "Rail C"), ("/api/apex/status", "Rail C")]
fx0, fy0, fw, fh, gx, gy = VX + 320, VY + 65, 210, 64, 230, 76
for i, (t, s) in enumerate(fns):
    col = i % 3
    row = i // 3
    node(fx0 + col * gx, fy0 + row * gy, fw, fh, t, s, C_FN[0], C_FN[1], title_size=13, sub_size=10)

# note: rate limiter
rect(VX + 320, VY + 65 + 3 * gy, 650, 36, "#fff6e9", "#e6c79a", rx=8, sw=1.2)
text(VX + 330, VY + 65 + 3 * gy + 23, "in-memory rate limit (rateLimit.ts) — resets per cold start; back with Vercel KV / Upstash for scale",
     size=11, color="#9a6212", anchor="start", italic=True)

arrow(VX + 155, VY + 145, VX + 155, VY + 175, label="serve")
arrow(VX + 280, VY + 214, VX + 320, VY + 130, label="/api/* fetch", lx=VX+330, ly=VY+200)

# --- clients (left bottom) ---
text(60, 760, "CLIENTS", size=12, color="#4b515c", weight="bold", anchor="start")
node(60, 775, 300, 86, "Browser + Wallet", "EVM (RainbowKit/wagmi)\nCIP-30 Cardano (Eternl/Lace)\nuser signs every tx", C_DEV[0], C_DEV[1], sub_size=10.5)
node(60, 885, 300, 70, "GitHub Pages (docs/)", "static Rails A·B only\ncalls Vercel /api/* for Rail C", C_GH[0], C_GH[1], sub_size=10.5)
arrow(360, 805, VX + 30, VY + 95, label="HTTPS", lx=480, ly=540)
arrow(360, 915, VX + 320, VY + 230, color="#7a6a3a", dash="6 5", label="cross-origin Rail C", lx=560, ly=720, lcolor="#7a6a3a")

# --- external systems (right column) ---
EX, EY, EW = 1110, 230, 390
text(EX, EY - 6, "EXTERNAL SYSTEMS / RAILS", size=12, color="#4b515c", weight="bold", anchor="start")
ext = [("Anthropic Claude API", "haiku -> sonnet (parsing)", "ANTHROPIC_API_KEY"),
       ("LayerZero / bAP3X OFT", "on-chain contracts · Rail A", "client-side signed"),
       ("NEAR Intents 1-Click", "deposit addr + solvers · Rail B", "ONECLICK_JWT"),
       ("Skyline Native Bridge", "web-api.mainnet.skylinebridge.tech · Rail C", "SKYLINE_API"),
       ("LayerZero Scan", "delivery tracking", "")]
for i, (t, s, tag) in enumerate(ext):
    y = EY + 18 + i * 92
    node(EX, y, EW, 78, t, s + (("\n" + tag) if tag else ""), C_EXT[0], C_EXT[1], sub_size=10)

# function -> external arrows
fn_right = VX + 320 + 2 * gx + fw  # right edge of fn grid col 3
arrow(fn_right, VY + 97, EX, EY + 18 + 0 * 92 + 39, label="parse", lx=1075, ly=300)
arrow(fn_right, VY + 97 + gy, EX, EY + 18 + 1 * 92 + 39, label="quoteSend", lx=1075, ly=395)
arrow(fn_right, VY + 97 + gy, EX, EY + 18 + 2 * 92 + 39, label="1-Click", lx=1075, ly=470)
arrow(fn_right, VY + 97 + 2 * gy, EX, EY + 18 + 3 * 92 + 39, label="proxy", lx=1075, ly=560)
# browser direct to OFT (client-side) and scan
arrow(210, 775, EX, EY + 18 + 1 * 92 + 60, color="#7c5cff", dash="6 5",
      label="Rail A: wallet signs OFT directly", lx=720, ly=860, lcolor="#5b3fd6")
arrow(EX, EY + 18 + 1 * 92 + 70, EX - 60, EY + 18 + 4 * 92 + 20, color="#69707d", dash="4 4", sw=1.6)

# legend
rect(60, 990, 1440, 150, "#ffffff", "#dde3ea", rx=12, sw=1.5)
text(82, 1018, "How a request flows", size=15, color="#16202e", weight="bold", anchor="start")
flow = ("Push to main triggers a Vercel build; the prebuilt React bundle is served from the Edge/CDN, while /api/* run as Node "
        "serverless functions that hold the secrets. The browser wallet signs every transaction — Rail A signs the LayerZero "
        "OFT contract directly; Rails B & C go through the functions (B = NEAR Intents, C = the CORS-locked Skyline API proxy).")
text(82, 1044, flow[:118], size=12.5, color="#44505f", anchor="start")
text(82, 1063, flow[118:240], size=12.5, color="#44505f", anchor="start")
text(82, 1082, flow[240:], size=12.5, color="#44505f", anchor="start")
lg = [("#0a0a0a", "Vercel platform"), ("#7c5cff", "Edge / CDN"), ("#3a7bd5", "Serverless fn"),
      ("#2f9e6f", "Env var"), ("#69707d", "External rail"), ("#2b3137", "Static / GH")]
lx0 = 82
for col, lab in lg:
    rect(lx0, 1100, 16, 16, col, col, rx=3, sw=0)
    text(lx0 + 23, 1113, lab, size=12, color="#44505f", anchor="start")
    lx0 += 28 + len(lab) * 7.4 + 26

svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + "".join(P) + "</svg>"
with open("docs/vercel-deployment.svg", "w") as f:
    f.write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="docs/vercel-deployment.png", output_width=W * 2, output_height=H * 2)
print("wrote docs/vercel-deployment.svg and docs/vercel-deployment.png")
