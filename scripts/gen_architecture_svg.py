#!/usr/bin/env python3
"""Generate a C4-style container diagram (SVG + PNG) for Skyline AI Bridge."""
import html
import cairosvg

W, H = 1520, 1180
P = []  # svg fragments


def esc(s):
    return html.escape(s, quote=True)


def rect(x, y, w, h, fill, stroke, rx=12, sw=2, dash=None, opacity=1.0):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    P.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d} opacity="{opacity}"/>'
    )


def text(x, y, s, size=15, color="#ffffff", weight="normal", anchor="middle",
         family="Segoe UI, Helvetica, Arial, sans-serif", italic=False):
    st = ' font-style="italic"' if italic else ""
    P.append(
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
        f'fill="{color}" font-weight="{weight}" text-anchor="{anchor}"{st}>{esc(s)}</text>'
    )


def node(x, y, w, h, title, sub, fill, stroke, tcolor="#ffffff",
         scolor="#e8eef6", title_size=15, sub_size=11):
    rect(x, y, w, h, fill, stroke)
    cx = x + w / 2
    if sub:
        text(cx, y + h / 2 - 4, title, size=title_size, color=tcolor, weight="bold")
        for i, line in enumerate(sub.split("\n")):
            text(cx, y + h / 2 + 16 + i * 14, line, size=sub_size, color=scolor)
    else:
        text(cx, y + h / 2 + 5, title, size=title_size, color=tcolor, weight="bold")


def arrow(x1, y1, x2, y2, color="#5b6472", label=None, sw=2.2, lx=None, ly=None,
          dash=None, label_color="#44505f"):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    P.append(
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
        f'stroke-width="{sw}" marker-end="url(#arrow)"{d}/>'
    )
    if label:
        mx = lx if lx is not None else (x1 + x2) / 2
        my = ly if ly is not None else (y1 + y2) / 2
        tw = len(label) * 6.4 + 12
        rect(mx - tw / 2, my - 11, tw, 20, "#ffffff", "#d6dce4", rx=5, sw=1)
        text(mx, my + 3, label, size=11, color=label_color, weight="bold")


# ---- palette ----
C_PERSON = ("#0b3d66", "#072a47")
C_SYS = ("#1168bd", "#0c4f90")
C_COMP = ("#3a7bd5", "#2a5da8")
C_LIB = ("#2f9e6f", "#23764f")
C_ROUTER = ("#e0892b", "#b86c1a")
C_EXT = ("#69707d", "#4b515c")
BG = "#f4f6f9"
BAND = "#ffffff"

# ---- defs ----
P.append(
    '<defs><marker id="arrow" markerWidth="11" markerHeight="11" refX="9" refY="3.2" '
    'orient="auto" markerUnits="userSpaceOnUse">'
    '<path d="M0,0 L9,3.2 L0,6.4 Z" fill="#5b6472"/></marker>'
    '<filter id="sh" x="-5%" y="-5%" width="110%" height="115%">'
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#9aa6b6" flood-opacity="0.4"/>'
    '</filter></defs>'
)
rect(0, 0, W, H, BG, BG, rx=0, sw=0)

# ---- title ----
text(60, 46, "Skyline AI Bridge — C4 Container Diagram", size=27, color="#16202e",
     weight="bold", anchor="start")
text(60, 72, "Plain-English cross-chain bridging · AI extracts intent · deterministic router picks the rail · the user signs every transaction",
     size=14, color="#5b6472", anchor="start")

# ---- user ----
node(620, 100, 280, 72, "User + Wallets",
     "EVM wallet (Base / BNB / Nexus)\nCIP-30 Cardano wallet (Prime / Vector)",
     C_PERSON[0], C_PERSON[1])

# ---- deployment flavors (side panel) ----
rect(1120, 96, 360, 86, "#eef3f8", "#c4d0de", rx=10, sw=1.5, dash="6 4")
text(1300, 118, "Deployment flavors (same product)", size=12.5, color="#44505f", weight="bold")
text(1300, 140, "Full app — this Next.js repo (Rails A·B·C)", size=11, color="#5b6472")
text(1300, 158, "GitHub Pages — docs/index.html (Rails A·B)", size=11, color="#5b6472")
text(1300, 175, "Standalone — index.html + .bat (no backend)", size=11, color="#5b6472")

# ---- big Next.js container ----
CX, CY, CW, CH = 60, 210, 1400, 600
rect(CX, CY, CW, CH, "#eaf1fb", "#9cb8de", rx=16, sw=2)
text(CX + 20, CY + 28, "Next.js 15 App  (React 19 · TypeScript · runtime: nodejs)",
     size=15, color="#1f4e86", weight="bold", anchor="start")

# Band 1: Frontend (UI)
text(CX + 20, CY + 62, "FRONTEND — React Client Components (UI)", size=12, color="#2a5da8",
     weight="bold", anchor="start")
fy = CY + 74
fb = [("page.tsx", "prompt + review card"), ("TransferCard", "the one card"),
      ("RailAExecutor", "OFT, client-side"), ("RailBExecutor", "NEAR confirm"),
      ("RailCExecutor", "Apex / Cardano"), ("Countdown\nHistoryList", "")]
fx = [90, 320, 550, 780, 1010, 1240]
for (t, s), x in zip(fb, fx):
    node(x, fy, 190, 70, t, s, C_COMP[0], C_COMP[1], sub_size=11)

# Band 2: API routes
text(CX + 20, CY + 178, "API ROUTES (server — secrets, rate limits, CORS proxy)",
     size=12, color="#2a5da8", weight="bold", anchor="start")
ay = CY + 190
ab = [("/api/parse", "NL -> Intent"), ("/api/execute", "Rail B + spend cap"),
      ("/api/quote · /status · /tokens", "live quotes + polling"),
      ("/api/apex/*", "Rail C CORS proxy")]
ax = [120, 420, 720, 1080]
aw = [240, 240, 320, 240]
for (t, s), x, w in zip(ab, ax, aw):
    node(x, ay, w, 66, t, s, "#5a86c2", "#3f659b", sub_size=11)

# Band 3: src/lib
text(CX + 20, CY + 290, "src/lib — SHARED LOGIC (the brains; the LLM has no say here)",
     size=12, color="#1f7a55", weight="bold", anchor="start")
ly = CY + 302
node(90, ly, 245, 84, "router.ts", "DETERMINISTIC\nrail selection A / B / C",
     C_ROUTER[0], C_ROUTER[1], sub_size=11)
lb = [("build.ts", "card + calldata\n(single source)"),
      ("intent · zod\nheuristic · claudeParse", "typed intent + parsers"),
      ("oft · oneclick", "LayerZero + NEAR\nadapters"),
      ("skyline · cardano\nchains · units", "Rail C + scope")]
lx = [363, 636, 909, 1182]
for (t, s), x in zip(lb, lx):
    node(x, ly, 245, 84, t, s, C_LIB[0], C_LIB[1], sub_size=10.5)

# ---- external systems ----
ey = 870
text(60, ey - 14, "EXTERNAL SYSTEMS / INFRASTRUCTURE", size=12, color="#4b515c",
     weight="bold", anchor="start")
eb = [("Anthropic Claude API", "haiku -> sonnet\n(parsing only)"),
      ("LayerZero / bAP3X OFT", "on-chain contracts\nRail A"),
      ("NEAR Intents 1-Click", "deposit addr + solvers\nRail B"),
      ("Skyline Native Bridge", "skylinebridge.tech\nRail C"),
      ("LayerZero Scan", "tx tracking")]
ex = [90, 363, 636, 909, 1182]
for (t, s), x in zip(eb, ex):
    node(x, ey, 245, 78, t, s, C_EXT[0], C_EXT[1], sub_size=10.5)

# ---- arrows ----
# user -> frontend
arrow(760, 172, 200, fy, color="#5b6472", label="types intent · signs", lx=470, ly=215)
# frontend -> api
arrow(185, fy + 70, 200, ay, label="prompt", lx=210, ly=CY + 168)
arrow(875, fy + 70, 520, ay, label="confirm", lx=690, ly=CY + 168)
arrow(1335, fy + 70, 1200, ay, dash="5 4", label="quotes", lx=1300, ly=CY + 168)
# RailA executor straight to OFT (client-side, bypasses server) — right edge route
arrow(1105, fy + 70, 1300, ey, color="#b86c1a", dash="6 5",
      label="signs OFT client-side", lx=1300, ly=CY + 168, label_color="#b86c1a")
# api -> lib
arrow(240, ay + 66, 210, ly, label="route", lx=205, ly=CY + 280)
arrow(540, ay + 66, 470, ly, label="build", lx=640, ly=CY + 280)
arrow(880, ay + 66, 1000, ly, label="adapters", lx=950, ly=CY + 280)
arrow(1200, ay + 66, 1300, ly, label="proxy", lx=1300, ly=CY + 280)
# lib -> external
arrow(700, ly + 84, 210, ey, label="parse", lx=300, ly=830)
arrow(1010, ly + 84, 470, ey, label="OFT quote", lx=620, ly=830)
arrow(1030, ly + 84, 760, ey, label="1-Click", lx=860, ly=830)
arrow(1300, ly + 84, 1030, ey, label="create/submit", lx=1120, ly=830)

# ---- safety callout ----
rect(60, 980, 1400, 150, "#fff8ee", "#e6c79a", rx=12, sw=1.5)
text(82, 1012, "Core safety property", size=15, color="#9a6212", weight="bold", anchor="start")
text(82, 1040, "The review card and the signed transaction calldata are built by the SAME function (build.ts) from the SAME zod-validated Intent.",
     size=13, color="#5b4a2a", anchor="start")
text(82, 1062, "tests/equivalence.test.ts asserts they can never diverge. The AI emits JSON only — it never picks the rail and never signs.",
     size=13, color="#5b4a2a", anchor="start")
# mini legend
lg = [("#0b3d66", "Person"), ("#3a7bd5", "UI component"), ("#5a86c2", "API route"),
      ("#2f9e6f", "Logic (src/lib)"), ("#e0892b", "Router"), ("#69707d", "External system")]
lx0 = 82
for col, lab in lg:
    rect(lx0, 1092, 16, 16, col, col, rx=3, sw=0)
    text(lx0 + 24, 1105, lab, size=12, color="#5b4a2a", anchor="start")
    lx0 += 30 + len(lab) * 7.6 + 26

svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + "".join(P) + "</svg>"

with open("docs/architecture.svg", "w") as f:
    f.write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="docs/architecture.png", output_width=W * 2, output_height=H * 2)
print("wrote docs/architecture.svg and docs/architecture.png")
