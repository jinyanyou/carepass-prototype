# -*- coding: utf-8 -*-
"""
CarePass 탐지 성능평가 — ① 라벨된 합성 평가셋 생성

설계 원칙 (가장 중요)
--------------------
이상치를 "규칙 위반"으로 만들고 같은 규칙으로 잡으면 정탐율은 당연히 100%가 된다.
그런 숫자는 아무것도 증명하지 못한다. 그래서 여기서는 **사기범의 목표와 행동**만 모델링하고,
탐지 규칙은 일절 참조하지 않는다. 결과적으로 어떤 공격은 규칙에 걸리고, 어떤 공격은
아무 탐지기에도 안 걸린다(미탐). 미탐이 나오는 것이 정상이다.

딱 한 군데 예외: '구조화(한도 회피)' 공격만은 사기범이 **건당 한도를 안다**고 가정한다.
한도는 대리인 화면에 그대로 표시되므로 현실적인 가정이고, 이 공격의 정의 자체가
"한도 바로 아래로 쪼갠다"이다. 이 가정은 REPORT.md에 명시한다.

출력: eval_set.json  (결제 시도 1건 = 레코드 1개, 라벨 포함)
"""
import json, math, random
from datetime import datetime, timedelta
from pathlib import Path

SEED = 20261007
random.seed(SEED)

OUT = Path(__file__).parent / "eval_set.json"

# ── 위임 설정 : 프로토타입(index.html)의 기본값과 동일 ──────────────────────
POOL_CAP = 3_000_000
FLOOR    = 500_000
# 위임 한도는 가구마다 다르게 잡는다. 이게 구조화(한도 회피) 공격의 성립 조건을 가른다.
#   loose  : 평소 병원비(μ≈9.4만)보다 한참 높게 묶은 집 → 한도 근처 금액은 z로도 튄다
#   tight  : 평소 지출에 가깝게 바짝 묶은 집 → 한도 근처 금액이 '평소 금액대'라 z로는 안 걸린다
# 두 집단을 반반 섞어, 구조화 탐지의 증분 가치가 어느 설정에서 나오는지 분리해 본다.
LIMIT_PROFILES = {
    "loose": {"hospital": {"per_tx": 300_000, "month_cap": 1_000_000},
              "utility":  {"per_tx": 200_000, "month_cap":   600_000}},
    "tight": {"hospital": {"per_tx": 150_000, "month_cap":   600_000},
              "utility":  {"per_tx": 200_000, "month_cap":   600_000}},
}
CATS = LIMIT_PROFILES["loose"]          # 기본값 (프로토타입 index.html과 동일)
HH_PROFILE = {}                          # household -> "loose" | "tight"


def lim(hh, cat):
    return LIMIT_PROFILES[HH_PROFILE[hh]][cat]

# ── 결제처 : 등록(건강보험심사평가원 요양기관 목록) / 미등록 ───────────────
REGISTERED = ["대구의료원", "경북대학교병원", "계명대학교동산병원", "대구가톨릭대학교병원",
              "영남대학교병원", "○○내과의원", "○○정형외과의원", "○○약국", "○○재활의학과의원"]
UTIL_MERCH = ["한국전력 공과금", "도시가스 요금", "KT 통신요금", "상수도 요금"]
UNREGISTERED = ["○○메디컬센터", "○○헬스케어", "○○실버케어", "○○한방병원(미등록)"]

N_HOUSEHOLDS = 120
DAYS = 180
START = datetime(2026, 4, 1, 9, 0)

# ── 정상 행동 모델 ────────────────────────────────────────────────────────
# 병원비는 오른쪽 꼬리가 긴 분포가 현실적이라 로그정규를 쓴다.
# (프로토타입의 makeHistory()는 정규분포를 2만~19만으로 절단(censoring)해 쓰는데,
#  절단은 σ를 과소추정시켜 z를 부풀린다 — REPORT.md '한계' 참고)
HOSP_MEDIAN, HOSP_SIGMA = 85_000, 0.45      # 평균 ≈ 94,000
UTIL_MU, UTIL_SD        = 145_000, 28_000
HOSP_PER_MONTH = 2.5
UTIL_PER_MONTH = 1.2


def hosp_amount():
    return int(round(random.lognormvariate(math.log(HOSP_MEDIAN), HOSP_SIGMA) / 1000) * 1000)


def util_amount():
    return int(round(random.gauss(UTIL_MU, UTIL_SD) / 1000) * 1000)


def biz_time(day):
    """평일 낮에 몰리는 결제 시각"""
    d = START + timedelta(days=day)
    if d.weekday() >= 5 and random.random() < 0.8:
        d += timedelta(days=(7 - d.weekday()))
    return d.replace(hour=random.choice([9, 10, 10, 11, 14, 14, 15, 16, 17]),
                     minute=random.randrange(60))


def rec(hh, ts, cat, amount, merchant, registered, inv=None, label=0, attack=""):
    """inv = {'amount':..,'inst':..,'sig_ok':..,'issued_days':..,'reused':..} 또는 None"""
    L = lim(hh, cat)
    return {
        "household": hh, "profile": HH_PROFILE[hh],
        "per_tx": L["per_tx"], "month_cap": L["month_cap"],
        "ts": ts.isoformat(timespec="minutes"), "cat": cat,
        "amount": amount, "merchant": merchant, "registered": registered,
        "inv_present": inv is not None,
        "inv_amount": inv["amount"] if inv else None,
        "inv_inst": inv["inst"] if inv else None,
        "inv_sig_ok": inv["sig_ok"] if inv else None,
        "inv_issued_days": inv["issued_days"] if inv else None,
        "inv_reused": inv["reused"] if inv else None,
        "label": label, "attack": attack,
    }


def normal_invoice(merchant, amount):
    """정상 결제의 90%에는 병원이 서명한 청구서가 따라온다 (나머지는 창구 수납 등)"""
    if random.random() < 0.10:
        return None
    return {"amount": amount, "inst": merchant, "sig_ok": True,
            "issued_days": random.choice([0, 0, 0, 1, 1, 2, 3]), "reused": False}


def gen_normal(hh):
    out = []
    for day in range(DAYS):
        if random.random() < HOSP_PER_MONTH / 30:
            m = random.choice(REGISTERED)
            a = hosp_amount()
            out.append(rec(hh, biz_time(day), "hospital", a, m, True, normal_invoice(m, a)))
        if random.random() < UTIL_PER_MONTH / 30:
            m = random.choice(UTIL_MERCH)
            out.append(rec(hh, biz_time(day), "utility", util_amount(), m, True, None))
    return out


# ── 공격 행동 모델 : 목표만 주고, 탐지 규칙은 보지 않는다 ──────────────────
def atk_drain_fast(hh, day0):
    """목표: 한 번에 크게 빼낸다. 급전이 필요한 대리인."""
    out = []
    for i in range(random.choice([1, 2])):
        target = random.uniform(0.6, 1.5) * lim(hh, "hospital")["month_cap"]
        a = int(round(target / 10_000) * 10_000)
        m = random.choice(REGISTERED)
        out.append(rec(hh, biz_time(day0 + i), "hospital", a, m, True, None, 1, "drain_fast"))
    return out


def atk_structuring(hh, day0):
    """목표: 80만~120만을 빼내되 '한 번에 큰 금액'으로 보이지 않게 쪼갠다.
       사기범은 대리인 화면에 뜨는 건당 한도를 알고 있다고 가정한다 (유일한 예외 가정)."""
    out = []
    per = lim(hh, "hospital")["per_tx"]        # 사기범은 화면에 뜨는 건당 한도를 안다
    target = random.uniform(800_000, 1_200_000)
    got = 0
    day = day0
    while got < target:
        a = int(round(per * random.uniform(0.92, 0.98) / 1000) * 1000)
        m = random.choice(REGISTERED)
        out.append(rec(hh, biz_time(day), "hospital", a, m, True, None, 1, "structuring"))
        got += a
        day += random.choice([1, 1, 2, 3])
    return out


def atk_fake_clinic(hh, day0):
    """목표: 사기범이 차린 유령 기관으로 결제를 돌린다.
       금액은 '평소 금액대'로 뽑는다 — 금액만 보는 탐지기로는 원리상 못 잡게."""
    out = []
    for i in range(random.choice([2, 3, 4])):
        m = random.choice(UNREGISTERED)
        a = hosp_amount()
        inv = {"amount": a, "inst": m, "sig_ok": False,      # 등록 공개키가 없으니 검증 실패
               "issued_days": 0, "reused": False}
        out.append(rec(hh, biz_time(day0 + i * 2), "hospital", a, m, False, inv, 1, "fake_clinic"))
    return out


def atk_invoice_tamper(hh, day0):
    """목표: 진짜 병원 청구서를 들고 가서 결제 금액만 부풀린다(차액을 챙긴다).
       일부는 건당 한도 안에 들어가 금액 규칙으로는 안 걸린다."""
    out = []
    for i in range(random.choice([2, 3])):
        m = random.choice(REGISTERED)
        real = hosp_amount()
        a = int(round(real * random.uniform(1.3, 3.0) / 1000) * 1000)
        inv = {"amount": real, "inst": m, "sig_ok": True,
               "issued_days": random.choice([0, 1, 2]), "reused": random.random() < 0.3}
        out.append(rec(hh, biz_time(day0 + i * 3), "hospital", a, m, True, inv, 1, "invoice_tamper"))
    return out


ATTACKS = [atk_drain_fast, atk_structuring, atk_fake_clinic, atk_invoice_tamper]


def main():
    records = []
    # 가구별 한도 프로파일 — 절반은 느슨하게, 절반은 바짝
    for hh in range(N_HOUSEHOLDS):
        HH_PROFILE[hh] = "loose" if hh % 2 == 0 else "tight"
    # 공격 가구 배정 — 유형별 12가구씩, 공격은 번인(60일) 이후에만 발생
    attack_hh = {}
    hhs = list(range(N_HOUSEHOLDS))
    random.shuffle(hhs)
    i = 0
    for fn in ATTACKS:
        for _ in range(12):
            attack_hh[hhs[i]] = fn
            i += 1

    for hh in range(N_HOUSEHOLDS):
        records += gen_normal(hh)
        if hh in attack_hh:
            records += attack_hh[hh](hh, random.randrange(70, DAYS - 20))

    records.sort(key=lambda r: (r["household"], r["ts"]))
    n_fraud = sum(r["label"] for r in records)
    meta = {
        "seed": SEED, "households": N_HOUSEHOLDS, "days": DAYS,
        "total": len(records), "fraud": n_fraud,
        "fraud_rate": round(n_fraud / len(records), 4),
        "burn_in_days": 60,
        "limit_profiles": LIMIT_PROFILES, "pool_cap": POOL_CAP, "floor": FLOOR,
        "profile_counts": {k: sum(1 for v in HH_PROFILE.values() if v == k)
                           for k in LIMIT_PROFILES},
        "note": "합성 데이터 자체 평가용. 실거래 성능이 아니며 이상치 비율도 가독성을 위한 설정이다.",
        "by_attack": {},
    }
    for r in records:
        if r["label"]:
            meta["by_attack"][r["attack"]] = meta["by_attack"].get(r["attack"], 0) + 1

    OUT.write_text(json.dumps({"meta": meta, "records": records}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"생성 완료 → {OUT.name}")
    print(f"  전체 {meta['total']}건 · 이상 {n_fraud}건 ({meta['fraud_rate']*100:.1f}%)")
    for k, v in sorted(meta["by_attack"].items()):
        print(f"  - {k}: {v}건")
    for prof in LIMIT_PROFILES:
        n = sum(1 for r in records if r["profile"] == prof and r["label"])
        print(f"  한도 {prof}: 이상 {n}건")


if __name__ == "__main__":
    main()
