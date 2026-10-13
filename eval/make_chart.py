# -*- coding: utf-8 -*-
"""
CarePass 탐지 성능평가 — ③ 발표용 그림 1장 (eval.png)

패널 A  공격 유형별 정탐율 (5안 × 4유형) — 순차 단일 색상(파랑) 히트맵
패널 B  z 임계 역산 — 정탐율·오탐율 2계열 선형
패널 C  결정 4(보류/알림 2단) 효과 — 마찰 대 차단력

색: 데이터 시각화 기준 팔레트의 검증된 값만 쓴다.
    범주형 slot1 #2a78d6 / slot2 #eb6834  (검증 통과: CVD ΔE 24.7, 일반 ΔE 33.6, 대비 3:1↑)
    순차 파랑 램프 #cde2fb → #0d366b
    표면 #fcfcfb · 본문 잉크 #0b0b0b / #52514e
"""
import json
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

plt.rcParams["font.family"] = "Malgun Gothic"
plt.rcParams["axes.unicode_minus"] = False

HERE = Path(__file__).parent
R = json.loads((HERE / "results.json").read_text(encoding="utf-8"))

SURFACE = "#fcfcfb"
INK, INK2, INK3 = "#0b0b0b", "#52514e", "#8b8a84"
S1, S2 = "#2a78d6", "#eb6834"
RAMP = LinearSegmentedColormap.from_list(
    "mintblue", ["#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"])

ARMS = list(R["arms"].keys())
SHORT = {"A 규칙만": "A\n규칙만",
         "B z-score만": "B\nz-score만",
         "C 규칙+z (멘토링 시점)": "C  규칙+z\n(멘토링 시점)",
         "D C+구조화+매칭 (현재)": "D  C+구조화\n+매칭 (현재)",
         "E D+Isolation Forest": "E  D+Isolation\nForest"}
ATK = {"drain_fast": "한 번에\n큰 금액", "structuring": "한도 아래\n분할",
       "fake_clinic": "미등록·사칭\n기관", "invoice_tamper": "청구서\n금액 조작"}
AK = list(ATK)

fig = plt.figure(figsize=(14.8, 6.0), dpi=200, facecolor=SURFACE)
gs = fig.add_gridspec(1, 3, width_ratios=[1.35, 1.0, 0.85], wspace=0.34,
                      left=0.082, right=0.978, top=0.755, bottom=0.135)

# ── 패널 A : 공격 유형별 정탐율 ───────────────────────────────────────────
axA = fig.add_subplot(gs[0, 0], facecolor=SURFACE)
M = np.array([[R["by_attack"][a][k] * 100 for k in AK] for a in ARMS])
axA.imshow(M, cmap=RAMP, vmin=0, vmax=100, aspect="auto")
for i in range(M.shape[0]):
    for j in range(M.shape[1]):
        v = M[i, j]
        axA.text(j, i, f"{v:.0f}%", ha="center", va="center",
                 color="#ffffff" if v >= 55 else INK,
                 fontsize=11.5, fontweight="bold")
axA.set_xticks(range(len(AK)), [ATK[k] for k in AK], fontsize=9.5, color=INK2)
axA.set_yticks(range(len(ARMS)), [SHORT[a] for a in ARMS], fontsize=9, color=INK2)
axA.tick_params(length=0)
for s in axA.spines.values():
    s.set_visible(False)
axA.set_title("공격 유형별 정탐율", fontsize=12.5, fontweight="bold", color=INK,
              loc="left", pad=30)
axA.text(0, 1.022, "z-score 단독(B)은 사칭·청구서 조작을 거의 못 잡는다",
         transform=axA.transAxes, fontsize=9.5, color=INK3)

# ── 패널 B : z 임계 역산 ──────────────────────────────────────────────────
axB = fig.add_subplot(gs[0, 1], facecolor=SURFACE)
zs = [s["z"] for s in R["z_sweep"]]
rc = [s["recall"] * 100 for s in R["z_sweep"]]
fp = [s["fpr"] * 100 for s in R["z_sweep"]]
axB.plot(zs, rc, color=S1, lw=2, solid_capstyle="round", label="정탐율")
axB.plot(zs, fp, color=S2, lw=2, solid_capstyle="round", label="오탐율")
zi = zs.index(3.0)
axB.axvline(3.0, color=INK3, lw=1, ls=(0, (3, 3)), zorder=0)
for y, c, lab in ((rc[zi], S1, f"정탐 {rc[zi]:.0f}%"), (fp[zi], S2, f"오탐 {fp[zi]:.1f}%")):
    axB.plot([3.0], [y], "o", ms=8, color=c, mec=SURFACE, mew=2, zorder=3)
    axB.annotate(lab, (3.0, y), textcoords="offset points", xytext=(9, 6),
                 fontsize=9.5, color=INK2, fontweight="bold")
axB.text(3.0, axB.get_ylim()[1] * 0.97, "현재 설정 z=3.0", ha="center", va="top",
         fontsize=9, color=INK3)
axB.set_xlabel("z 임계값", fontsize=10, color=INK2)
axB.set_ylabel("%", fontsize=10, color=INK2)
axB.grid(axis="y", color="#e8e7e2", lw=0.8)
axB.set_axisbelow(True)
for sp in ("top", "right"):
    axB.spines[sp].set_visible(False)
for sp in ("left", "bottom"):
    axB.spines[sp].set_color("#dedcd5")
axB.tick_params(colors=INK2, labelsize=9, length=3)
axB.legend(frameon=False, fontsize=9.5, labelcolor=INK2, loc="upper right")
axB.set_title("z 임계 역산 (z 단독)", fontsize=12.5, fontweight="bold", color=INK,
              loc="left", pad=30)
axB.text(0, 1.022, "오탐율 1% 이하로 낮추려면 z≥3.3이 필요하다",
         transform=axB.transAxes, fontsize=9.5, color=INK3)

# ── 패널 C : 결정 4 2단 정책 ──────────────────────────────────────────────
axC = fig.add_subplot(gs[0, 2], facecolor=SURFACE)
pl = R["policy"]
before = [R["clean"]["D C+구조화+매칭 (현재)"]["rate"] * 100, R["arms"]["D C+구조화+매칭 (현재)"]["recall"] * 100]
after = [pl["clean_hold_rate"] * 100, pl["fraud_hold_rate"] * 100]
x = np.arange(2)
w = 0.34
b1 = axC.bar(x - w / 2 - 0.01, before, w, color=S1, label="전부 보류", zorder=2)
b2 = axC.bar(x + w / 2 + 0.01, after, w, color=S2, label="결정 4 · 2단", zorder=2)
for bars in (b1, b2):
    for r_ in bars:
        axC.text(r_.get_x() + r_.get_width() / 2, r_.get_height() + 1.8,
                 f"{r_.get_height():.1f}%", ha="center", fontsize=9.5,
                 fontweight="bold", color=INK2)
axC.set_xticks(x, ["평상시 결제\n보류율 (마찰)", "사기 결제를\n보류로 차단"], fontsize=9.5, color=INK2)
axC.set_ylim(0, 115)
axC.grid(axis="y", color="#e8e7e2", lw=0.8)
axC.set_axisbelow(True)
for sp in ("top", "right"):
    axC.spines[sp].set_visible(False)
for sp in ("left", "bottom"):
    axC.spines[sp].set_color("#dedcd5")
axC.tick_params(colors=INK2, labelsize=9, length=3)
axC.legend(frameon=False, fontsize=9.5, labelcolor=INK2, loc="upper left",
           bbox_to_anchor=(-0.02, 1.0))
axC.set_title("보류 vs 보호자 알림 2단", fontsize=12.5, fontweight="bold", color=INK,
              loc="left", pad=30)
axC.text(0, 1.022, f"마찰 9.8%→0.8% · 포착율 {pl['fraud_any_rate']*100:.1f}%는 유지",
         transform=axC.transAxes, fontsize=9.5, color=INK3)

# ── 제목 · 각주 ───────────────────────────────────────────────────────────
m = R["meta"]
fig.text(0.082, 0.952, "CarePass 이상탐지 자체 성능평가", fontsize=16, fontweight="bold", color=INK)
fig.text(0.082, 0.903,
         f"합성 평가셋 {m['scored']:,}건(이상 {m['scored_fraud']}건, "
         f"{m['scored_fraud']/m['scored']*100:.1f}%) · 번인 {m['burn_in_records']}건은 baseline 추정 전용",
         fontsize=10, color=INK2)
fig.text(0.082, 0.032,
         "합성 데이터 기준 자체 평가이며 실거래 성능이 아니다. 이상치 비율은 가독성을 위한 설정이다. "
         "E안(Isolation Forest)은 오프라인 평가 전용이며 앱에는 탑재하지 않았다.",
         fontsize=8.5, color=INK3)

fig.savefig(HERE / "eval.png", facecolor=SURFACE)
print("eval.png 저장 완료")
