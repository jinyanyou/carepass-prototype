# -*- coding: utf-8 -*-
"""
CarePass 탐지 성능평가 — ② 5안 비교 · 혼동행렬 · z 임계 역산

5안
---
A 규칙만            한도·보호선·미등록기관·청구금액 불일치
B z-score만         z >= 3
C 규칙 + z          ← 멘토링(2026-10-05) 시점의 앱
D C + 구조화 + 청구-결제 매칭(기관·발행일·중복)   ← 현재 앱 (2026-10-07 추가분)
E D + Isolation Forest (다변량)                  ← 오프라인 확장. 앱에는 탑재하지 않음

중요
----
* 특징은 **그 시점까지의 과거 기록만으로** 계산한다 (미래 참조 없음).
* 가구별 이력이 적은 초기에는 집단(cohort) 평균으로 축소추정(shrinkage)한다 — 콜드스타트 대응.
* 처음 60일은 번인(baseline 추정 전용)이라 채점하지 않는다.
* Isolation Forest는 **정상만 있는 번인 구간**으로 학습한다 (라벨 미사용, 비지도).

출력: results.json · eval.png · (REPORT.md는 수치를 보고 사람이 작성)
"""
import json, math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
DATA = json.loads((HERE / "eval_set.json").read_text(encoding="utf-8"))
META, RECS = DATA["meta"], DATA["records"]
POOL_CAP, FLOOR = META["pool_cap"], META["floor"]
BURN_IN_DAYS = META["burn_in_days"]

Z_HARD = 3.0            # 앱의 현재 임계 (danger)
NEAR = 0.9              # 건당 한도 근접률
STRUCT_MIN = 3          # 7일 윈도 내 근접 결제 횟수
STRUCT_WINDOW = 7
INV_VALID_DAYS = 14
SHRINK_K = 10           # 축소추정 강도: 개인 n건 vs 집단 K건

T0 = datetime.fromisoformat(min(r["ts"] for r in RECS))


def ts(r):
    return datetime.fromisoformat(r["ts"])


# ── 1. 집단 baseline (번인 구간의 정상 결제만) ────────────────────────────
def cohort_baseline():
    buf = defaultdict(list)
    for r in RECS:
        if (ts(r) - T0).days < BURN_IN_DAYS and not r["label"]:
            buf[r["cat"]].append(r["amount"])
    return {c: (float(np.mean(v)), float(np.std(v, ddof=1))) for c, v in buf.items()}


COHORT = cohort_baseline()


# ── 2. 특징 추출 (과거만 사용) ────────────────────────────────────────────
def featurize():
    hist = defaultdict(list)          # (household, cat) -> [(ts, amount)]
    rows = []
    for r in sorted(RECS, key=lambda x: (x["ts"], x["household"])):
        hh, cat, amt, t = r["household"], r["cat"], r["amount"], ts(r)
        per_tx, month_cap = r["per_tx"], r["month_cap"]   # 한도는 가구마다 다르다
        past = hist[(hh, cat)]

        # 개인 평균/표준편차 — 집단 baseline으로 축소추정 (콜드스타트)
        mu_p, sd_p = COHORT[cat]
        amts = [a for _, a in past]
        n = len(amts)
        if n >= 2:
            mu_i, sd_i = float(np.mean(amts)), float(np.std(amts, ddof=1))
        elif n == 1:
            mu_i, sd_i = float(amts[0]), sd_p
        else:
            mu_i, sd_i = mu_p, sd_p
        mu = (n * mu_i + SHRINK_K * mu_p) / (n + SHRINK_K)
        sd = (n * sd_i + SHRINK_K * sd_p) / (n + SHRINK_K)
        sd = max(sd, 1.0)
        z = (amt - mu) / sd

        # 구조화 특징 — 7일 윈도 내 '한도 근접' 결제 수·누적
        w0 = t.timestamp() - STRUCT_WINDOW * 86400
        near_past = [(tt, a) for tt, a in past if tt.timestamp() >= w0 and a / per_tx >= NEAR]
        ratio = amt / per_tx
        cur_near = ratio >= NEAR and amt <= per_tx
        near_n = len(near_past) + (1 if cur_near else 0)
        near_sum = sum(a for _, a in near_past) + (amt if cur_near else 0)

        # 30일 누적(월 한도 대용) · 위임 풀 잔액 추정
        m0 = t.timestamp() - 30 * 86400
        spent30 = sum(a for tt, a in past if tt.timestamp() >= m0)
        pool_spent = sum(a for (h, c), lst in hist.items() if h == hh
                         for tt, a in lst if tt.timestamp() >= m0)
        pool_bal = POOL_CAP - pool_spent

        prev_gap = (t - past[-1][0]).total_seconds() / 86400 if past else 999.0

        rows.append({
            "r": r, "t": t, "day": (t - T0).days,
            "z": z, "ratio": ratio, "near_n": near_n, "near_sum": near_sum,
            "spent30": spent30, "spent_ratio": (spent30 + amt) / month_cap,
            "pool_bal": pool_bal, "prev_gap": prev_gap,
            "hour": t.hour, "weekday": t.weekday(),
            "over_tx": amt > per_tx,
            "over_month": (spent30 + amt) > month_cap,
            "floor_breach": (pool_bal - amt) < FLOOR,
            "unregistered": not r["registered"],
            "inv_amt_bad": bool(r["inv_present"] and r["inv_amount"] != amt),
            "inv_sig_bad": bool(r["inv_present"] and not r["inv_sig_ok"]),
            "inv_inst_bad": bool(r["inv_present"] and r["inv_inst"] != r["merchant"]),
            "inv_stale": bool(r["inv_present"] and (r["inv_issued_days"] or 0) > INV_VALID_DAYS),
            "inv_reused": bool(r["inv_present"] and r["inv_reused"]),
        })
        hist[(hh, cat)].append((t, amt))
    return rows


ROWS = featurize()
SCORED = [x for x in ROWS if x["day"] >= BURN_IN_DAYS]
TRAIN = [x for x in ROWS if x["day"] < BURN_IN_DAYS]      # 전부 정상 (번인)


# ── 3. 탐지기 ─────────────────────────────────────────────────────────────
def det_rules(x):
    """A — 멘토링 당시 구현돼 있던 규칙"""
    return (x["over_tx"] or x["over_month"] or x["floor_breach"]
            or x["unregistered"] or x["inv_amt_bad"] or x["inv_sig_bad"])


def det_z(x, thr=Z_HARD):
    return x["z"] >= thr


def det_struct(x):
    """D 신규 — 구조화(한도 회피)"""
    return x["ratio"] >= NEAR and x["near_n"] >= STRUCT_MIN


def det_match_ext(x):
    """D 신규 — 청구-결제 매칭 중 기관·발행일·중복 (금액 대조는 A에 이미 있음)"""
    return x["inv_inst_bad"] or x["inv_stale"] or x["inv_reused"]


IF_FEATS = ["z", "ratio", "near_n", "near_sum", "spent_ratio", "prev_gap", "hour", "weekday"]


def fit_isolation_forest():
    from sklearn.ensemble import IsolationForest
    Xtr = np.array([[x[f] for f in IF_FEATS] for x in TRAIN], dtype=float)
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
    clf = IsolationForest(n_estimators=300, max_samples="auto",
                          contamination="auto", random_state=20261007)
    clf.fit((Xtr - mu) / sd)
    # 임계: 학습(정상) 구간 오탐 1% 지점
    s_tr = clf.score_samples((Xtr - mu) / sd)
    thr = float(np.percentile(s_tr, 1.0))
    Xs = np.array([[x[f] for f in IF_FEATS] for x in SCORED], dtype=float)
    s = clf.score_samples((Xs - mu) / sd)
    return {id(x): bool(si < thr) for x, si in zip(SCORED, s)}, thr


IF_FLAG, IF_THR = fit_isolation_forest()


ARMS = {
    "A 규칙만":            lambda x: det_rules(x),
    "B z-score만":         lambda x: det_z(x),
    "C 규칙+z (멘토링 시점)": lambda x: det_rules(x) or det_z(x),
    "D C+구조화+매칭 (현재)": lambda x: det_rules(x) or det_z(x) or det_struct(x) or det_match_ext(x),
    "E D+Isolation Forest": lambda x: (det_rules(x) or det_z(x) or det_struct(x)
                                       or det_match_ext(x) or IF_FLAG[id(x)]),
}


# ── 4. 채점 ───────────────────────────────────────────────────────────────
def by_design(x):
    """위임자가 정한 한도에 걸린 것 — 탐지기의 '오탐'이 아니라 설정대로 동작한 보류.
       전체 보류율과 '순수 탐지 오탐율'을 나눠 보고하기 위해 분리한다."""
    return x["over_tx"] or x["over_month"] or x["floor_breach"]


def confusion(pred):
    tp = fp = fn = tn = 0
    fp_design = fp_detect = 0
    for x, p_ in zip(SCORED, pred):
        y = x["r"]["label"]
        if y and p_: tp += 1
        elif y and not p_: fn += 1
        elif not y and p_:
            fp += 1
            if by_design(x): fp_design += 1
            else: fp_detect += 1
        else: tn += 1
    nneg = fp + tn
    rec = tp / (tp + fn) if tp + fn else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "recall": rec,
            "fpr": fp / nneg if nneg else 0.0,
            "fpr_detect": fp_detect / nneg if nneg else 0.0,   # 한도 보류를 뺀 순수 탐지 오탐
            "fp_design": fp_design, "fp_detect": fp_detect,
            "precision": tp / (tp + fp) if tp + fp else 0.0}


ATTACK_LABEL = {"drain_fast": "한 번에 큰 금액", "structuring": "한도 아래 분할",
                "fake_clinic": "미등록·사칭 기관", "invoice_tamper": "청구서 금액 조작"}
ATTACKS = list(ATTACK_LABEL)

results = {"meta": {
    "scored": len(SCORED),
    "scored_fraud": sum(x["r"]["label"] for x in SCORED),
    "burn_in_records": len(TRAIN),
    "z_hard": Z_HARD, "near": NEAR, "struct_min": STRUCT_MIN,
    "struct_window_days": STRUCT_WINDOW, "shrink_k": SHRINK_K,
    "if_features": IF_FEATS, "if_threshold_pct": 1.0,
}, "arms": {}, "by_attack": {}, "z_sweep": [], "fp_causes": {}, "notes": {}}

for name, fn in ARMS.items():
    pred = [fn(x) for x in SCORED]
    results["arms"][name] = confusion(pred)
    results["by_attack"][name] = {
        a: (sum(pred[i] for i, x in enumerate(SCORED) if x["r"]["attack"] == a)
            / max(1, sum(1 for x in SCORED if x["r"]["attack"] == a)))
        for a in ATTACKS}

# 오탐 원인 분해 (D안 기준)
FLAGS = [("over_month", "월 누적 한도 초과"), ("over_tx", "건당 한도 초과"),
         ("floor_breach", "생활비 보호선 침범"), ("z_hi", "z-score 임계 초과"),
         ("struct", "구조화 패턴"), ("inv", "청구서 불일치"), ("unreg", "미등록 결제처")]
cause = {k: 0 for k, _ in FLAGS}
for x in SCORED:
    if x["r"]["label"]:
        continue
    hit = {"over_month": x["over_month"], "over_tx": x["over_tx"], "floor_breach": x["floor_breach"],
           "z_hi": x["z"] >= Z_HARD, "struct": det_struct(x),
           "inv": x["inv_amt_bad"] or x["inv_sig_bad"] or det_match_ext(x),
           "unreg": x["unregistered"]}
    for k, v in hit.items():
        if v:
            cause[k] += 1
results["fp_causes"] = {lab: cause[k] for k, lab in FLAGS}

# 사기로 한도가 소진돼 이후 정상 결제가 막히는 연쇄 — 오탐 86건의 정체
atk_hh = {x["r"]["household"] for x in SCORED if x["r"]["label"]}
results["notes"]["over_month_in_attacked_hh"] = sum(
    1 for x in SCORED if not x["r"]["label"] and x["over_month"] and x["r"]["household"] in atk_hh)
results["notes"]["over_month_total"] = sum(
    1 for x in SCORED if not x["r"]["label"] and x["over_month"])

# 결정 4 검증 — D안이 잡은 것을 '보류'와 '보호자 알림' 2단으로 나누면?
# 보류는 결제를 막으므로 마찰이 크다. 고위험 조합만 보류하고 나머지는 알림으로 내리는 게
# 결정 4의 설계인데, 그러면 마찰이 얼마나 줄고 차단력은 얼마나 남는지 수치로 확인한다.
def pol_hold(x):
    """보류 — 주요 위험 시나리오만"""
    return (x["unregistered"] or x["inv_sig_bad"] or x["inv_inst_bad"] or x["inv_reused"]
            or det_struct(x) or (x["over_tx"] and x["z"] >= Z_HARD))


def pol_notify(x):
    """보호자 알림 — D가 잡았지만 보류까지는 아닌 것 (결제는 진행, 사후 이의제기 가능)"""
    return ARMS["D C+구조화+매칭 (현재)"](x) and not pol_hold(x)


_all_hh = {x["r"]["household"] for x in SCORED}
_atk_hh = {x["r"]["household"] for x in SCORED if x["r"]["label"]}
_CLEAN = [x for x in SCORED if x["r"]["household"] in (_all_hh - _atk_hh)]
_fraud = [x for x in SCORED if x["r"]["label"]]
results["policy"] = {
    "clean_hold_rate": sum(1 for x in _CLEAN if pol_hold(x)) / len(_CLEAN),
    "clean_notify_rate": sum(1 for x in _CLEAN if pol_notify(x)) / len(_CLEAN),
    "fraud_hold_rate": sum(1 for x in _fraud if pol_hold(x)) / len(_fraud),
    "fraud_any_rate": sum(1 for x in _fraud if pol_hold(x) or pol_notify(x)) / len(_fraud),
}


# 공격이 전혀 없는 가구만 따로 — 평상시 사용자가 겪는 마찰(보류율)
all_hh = {x["r"]["household"] for x in SCORED}
atk_hh2 = {x["r"]["household"] for x in SCORED if x["r"]["label"]}
CLEAN = [x for x in SCORED if x["r"]["household"] in (all_hh - atk_hh2)]
results["clean"] = {"records": len(CLEAN), "households": len(all_hh - atk_hh2)}
for name, fn in ARMS.items():
    hold = sum(1 for x in CLEAN if fn(x))
    results["clean"][name] = {"hold": hold, "rate": hold / len(CLEAN) if CLEAN else 0.0}


# 한도 프로파일별 구조화 정탐율 — 구조화 탐지의 증분 가치가 어디서 나오는지
results["by_profile"] = {}
for name, fn in ARMS.items():
    per = {}
    for prof in ("loose", "tight"):
        idx = [x for x in SCORED if x["r"]["attack"] == "structuring" and x["r"]["profile"] == prof]
        per[prof] = (sum(fn(x) for x in idx) / len(idx)) if idx else None
    results["by_profile"][name] = per

# 공격 시퀀스별 "몇 번째 결제에서 처음 잡히는가" + 그 전까지 빠져나간 금액
# 월 누적 한도는 '다 쓴 뒤에야' 걸리므로, 같은 정탐율이라도 늦게 잡으면 피해가 크다.
episodes = defaultdict(list)
for x in SCORED:
    if x["r"]["label"]:
        episodes[(x["r"]["household"], x["r"]["attack"])].append(x)
for v in episodes.values():
    v.sort(key=lambda x: x["t"])

results["timing"] = {}
for name, fn in ARMS.items():
    per = {}
    for a in ATTACKS:
        firsts, leaks, caught = [], [], 0
        for (hh, at), seq in episodes.items():
            if at != a:
                continue
            hit = next((i for i, x in enumerate(seq) if fn(x)), None)
            if hit is None:
                leaks.append(sum(x["r"]["amount"] for x in seq))
                continue
            caught += 1
            firsts.append(hit + 1)
            leaks.append(sum(x["r"]["amount"] for x in seq[:hit]))
        per[a] = {"first_hit_mean": float(np.mean(firsts)) if firsts else None,
                  "leaked_mean": float(np.mean(leaks)) if leaks else 0.0,
                  "episodes": sum(1 for (hh, at) in episodes if at == a),
                  "episodes_caught": caught}
    results["timing"][name] = per

# z 임계 역산 — z 단독으로 쓸어야 z의 기여만 분리된다
for thr in [round(t, 2) for t in np.arange(1.5, 5.01, 0.1)]:
    pred = [det_z(x, thr) for x in SCORED]
    c = confusion(pred)
    results["z_sweep"].append({"z": thr, "recall": c["recall"], "fpr": c["fpr"],
                               "precision": c["precision"], "fp": c["fp"]})

(HERE / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

# ── 5. 출력 ───────────────────────────────────────────────────────────────
m = results["meta"]
print(f"채점 {m['scored']}건 (이상 {m['scored_fraud']}건, {m['scored_fraud']/m['scored']*100:.1f}%) "
      f"· 번인 {m['burn_in_records']}건은 baseline 추정 전용\n")
print(f"{'안':<26}{'TP':>5}{'FP':>5}{'FN':>5}{'TN':>6}{'정탐율':>9}{'보류율':>9}{'탐지오탐':>9}")
for n_, c in results["arms"].items():
    print(f"{n_:<26}{c['tp']:>5}{c['fp']:>5}{c['fn']:>5}{c['tn']:>6}"
          f"{c['recall']*100:>8.1f}%{c['fpr']*100:>8.1f}%{c['fpr_detect']*100:>8.1f}%")
print("  보류율 = 정상인데 보류된 비율(사용자 체감) · 탐지오탐 = 그중 한도 초과를 뺀 순수 오탐")

print("\n공격 유형별 정탐율")
print(f"{'안':<26}" + "".join(f"{ATTACK_LABEL[a]:>16}" for a in ATTACKS))
for n_ in ARMS:
    print(f"{n_:<26}" + "".join(f"{results['by_attack'][n_][a]*100:>15.0f}%" for a in ATTACKS))

print("\n정상 결제가 보류된 원인 (중복 집계)")
for lab, v in results["fp_causes"].items():
    if v:
        print(f"  {v:>4}건  {lab}")
nb = results["notes"]
print(f"  → '월 누적 한도 초과' {nb['over_month_total']}건 중 {nb['over_month_in_attacked_hh']}건은 "
      f"**사기 결제가 한도를 먼저 소진해** 뒤따르는 정상 결제가 막힌 연쇄다")

pl = results["policy"]
print("\n결정 4 검증 — D안의 탐지를 '보류'와 '보호자 알림'으로 나누면")
print(f"  평상시(공격 없는 가구) 결제 보류율   {pl['clean_hold_rate']*100:>5.1f}%   (2단 적용 전 9.8% → 여기까지 내려간다)")
print(f"  평상시 보호자 알림만 가는 비율       {pl['clean_notify_rate']*100:>5.1f}%   (결제는 그대로 진행)")
print(f"  사기 결제를 '보류'로 실제 막은 비율   {pl['fraud_hold_rate']*100:>5.1f}%")
print(f"  사기 결제를 보류+알림으로 포착한 비율 {pl['fraud_any_rate']*100:>5.1f}%")


print(f"\n공격이 없는 가구({results['clean']['households']}가구 · {results['clean']['records']}건) 보류율 — 평상시 마찰")
for n_ in ARMS:
    c_ = results["clean"][n_]
    print(f"  {n_:<26}{c_['rate']*100:>6.1f}%  ({c_['hold']}건)")


print("\n한도 설정별 '한도 아래 분할' 정탐율 — 구조화 탐지가 어디서 값을 하는가")
print(f"{'안':<26}{'느슨한 한도(30만)':>20}{'바짝 묶은 한도(15만)':>22}")
for n_ in ARMS:
    b = results["by_profile"][n_]
    print(f"{n_:<26}{b['loose']*100:>19.0f}%{b['tight']*100:>21.0f}%")

print("\n공격 시퀀스 차단 시점 — 몇 번째 결제에서 처음 잡히나 / 그 전까지 빠져나간 평균 금액")
print(f"{'안':<26}" + "".join(f"{ATTACK_LABEL[a]:>24}" for a in ATTACKS))
for n_ in ARMS:
    cells = []
    for a in ATTACKS:
        t_ = results["timing"][n_][a]
        fh = f"{t_['first_hit_mean']:.1f}번째" if t_["first_hit_mean"] else "미탐"
        cells.append(f"{fh} / {t_['leaked_mean']:,.0f}원")
    print(f"{n_:<26}" + "".join(f"{c:>23}" for c in cells))


print("\nz 임계 역산 (z 단독)")
print(f"{'z':>6}{'정탐율':>10}{'오탐율':>10}{'오탐건수':>10}")
for s_ in results["z_sweep"]:
    if abs(s_["z"] * 10 - round(s_["z"] * 10)) < 1e-9 and round(s_["z"] * 10) % 5 == 0:
        print(f"{s_['z']:>6.1f}{s_['recall']*100:>9.1f}%{s_['fpr']*100:>9.2f}%{s_['fp']:>10}")
cur = [s_ for s_ in results["z_sweep"] if abs(s_["z"] - Z_HARD) < 1e-6][0]
one = min((s_ for s_ in results["z_sweep"] if s_["fpr"] <= 0.01), key=lambda s_: s_["z"], default=None)
print(f"\n현재 앱 z={Z_HARD}: 정탐율 {cur['recall']*100:.1f}% · 오탐율 {cur['fpr']*100:.2f}% ({cur['fp']}건)")
if one:
    print(f"오탐율 1% 이하로 낮추려면 z>={one['z']:.1f} (그때 정탐율 {one['recall']*100:.1f}%)")
