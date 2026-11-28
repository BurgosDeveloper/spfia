"""
SPFIA v4 — Quantitative Multi-League Training, Calibration & Walk-Forward Backtest
Uses 100% real historical data from football-data.co.uk across 16 verified European leagues
(seasons 2024/25, 2025/26, 2026/27) and exports calibrated parameters + tree ensembles
to src/lib/model/calibrated_model.json for deterministic TypeScript inference.

Strict zero-leakage chronological order:
  - Train split:       date < 2026-02-01  (24/25 + first half of 25/26)
  - Calibration split: 2026-02-01 <= date < 2026-07-15 (second half of 25/26)
  - Out-of-sample:     date >= 2026-07-15 (entire 26/27 season up to latest match)
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, date, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

VERIFIED_LEAGUES = [
    ("E0", "Premier League", "Inglaterra"),
    ("E1", "Championship", "Inglaterra"),
    ("SP1", "LaLiga", "España"),
    ("SP2", "LaLiga 2", "España"),
    ("I1", "Serie A", "Italia"),
    ("I2", "Serie B", "Italia"),
    ("D1", "Bundesliga", "Alemania"),
    ("D2", "2. Bundesliga", "Alemania"),
    ("F1", "Ligue 1", "Francia"),
    ("F2", "Ligue 2", "Francia"),
    ("P1", "Primeira Liga", "Portugal"),
    ("N1", "Eredivisie", "Países Bajos"),
    ("B1", "Jupiler Pro League", "Bélgica"),
    ("SC0", "Premiership", "Escocia"),
    ("T1", "Süper Lig", "Turquía"),
    ("G1", "Super League", "Grecia"),
]

SEASONS = ["2425", "2526", "2627"]
TRAIN_CUTOFF = "2026-02-01"
TEST_CUTOFF = "2026-07-15"

XI = 0.0055          # Exponential time-decay (~126 day half-life)
K_PRIOR = 5.0        # Bayesian shrinkage prior weight in matches
SOT_BLEND_WEIGHT = 0.35

TARGETS = [
    "GOALS_O15",
    "GOALS_O25",
    "CORNERS_O65",
    "CORNERS_O75",
    "DC_1X",
    "DC_X2",
    "DC1X_O15",
    "DCX2_O15",
    "HOME_O15",
    "CORNERS_O85",
]

ROOT_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT_DIR / "ml" / "data_cache"
OUTPUT_MODEL_PATH = ROOT_DIR / "src" / "lib" / "model" / "calibrated_model.json"

SSL_CTX = ssl.create_default_context()
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (SPFIA Quant Trainer)"}


# ---------------------------------------------------------------------------
# Math Utilities (matched bit-for-bit in src/lib/math/poisson.ts)
# ---------------------------------------------------------------------------

def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else (hi if x > hi else x)


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-min(z, 35.0)))
    ez = math.exp(max(z, -35.0))
    return ez / (1.0 + ez)


def sigmoid_arr(z: np.ndarray) -> np.ndarray:
    zc = np.clip(z, -35.0, 35.0)
    return 1.0 / (1.0 + np.exp(-zc))


def safe_logit(p: float) -> float:
    pc = clamp(p, 1e-4, 1.0 - 1e-4)
    return math.log(pc / (1.0 - pc))


def poisson_pmf(k: int, lam: float) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def dixon_coles_tau(h: int, a: int, lam_h: float, lam_a: float, rho: float) -> float:
    if h == 0 and a == 0:
        return 1.0 - lam_h * lam_a * rho
    if h == 1 and a == 0:
        return 1.0 + lam_a * rho
    if h == 0 and a == 1:
        return 1.0 + lam_h * rho
    if h == 1 and a == 1:
        return 1.0 - rho
    return 1.0


def dixon_coles_matrix(lam_h: float, lam_a: float, rho: float, max_goals: int = 10) -> Dict[str, float]:
    pmf_h = [poisson_pmf(h, lam_h) for h in range(max_goals + 1)]
    pmf_a = [poisson_pmf(a, lam_a) for a in range(max_goals + 1)]

    total = 0.0
    mat = [[0.0] * (max_goals + 1) for _ in range(max_goals + 1)]
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            tau = max(0.01, dixon_coles_tau(h, a, lam_h, lam_a, rho))
            val = pmf_h[h] * pmf_a[a] * tau
            mat[h][a] = val
            total += val

    inv = 1.0 / max(1e-12, total)
    p_h = p_d = p_a = p_o15 = p_o25 = p_00 = p_le1 = 0.0
    p_1x_o15 = p_x2_o15 = p_home_o15 = 0.0
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            p = mat[h][a] * inv
            if h > a:
                p_h += p
            elif h == a:
                p_d += p
            else:
                p_a += p
            tot_g = h + a
            if tot_g > 1.5:
                p_o15 += p
            if tot_g > 2.5:
                p_o25 += p
            if tot_g == 0:
                p_00 += p
            if tot_g <= 1:
                p_le1 += p
            if h >= a and tot_g >= 2:
                p_1x_o15 += p
            if a >= h and tot_g >= 2:
                p_x2_o15 += p
            if h >= 2:
                p_home_o15 += p

    return {
        "pO15": clamp(p_o15, 0.001, 0.999),
        "pO25": clamp(p_o25, 0.001, 0.999),
        "pU25": clamp(1.0 - p_o25, 0.001, 0.999),
        "p1X": clamp(p_h + p_d, 0.001, 0.999),
        "pX2": clamp(p_d + p_a, 0.001, 0.999),
        "pH": clamp(p_h, 0.001, 0.999),
        "pD": clamp(p_d, 0.001, 0.999),
        "pA": clamp(p_a, 0.001, 0.999),
        "p00": clamp(p_00, 0.001, 0.999),
        "pLe1": clamp(p_le1, 0.001, 0.999),
        "p1XO15": clamp(p_1x_o15, 0.001, 0.999),
        "pX2O15": clamp(p_x2_o15, 0.001, 0.999),
        "pHomeO15": clamp(p_home_o15, 0.001, 0.999),
    }


def neg_bin_pmf(k: int, mu: float, r: float) -> float:
    if mu <= 0:
        return 1.0 if k == 0 else 0.0
    p = r / (r + mu)
    log_p = (
        math.lgamma(k + r)
        - math.lgamma(r)
        - math.lgamma(k + 1)
        + r * math.log(p)
        + k * math.log(max(1e-12, 1.0 - p))
    )
    return math.exp(log_p)


def prob_over_neg_bin(mu: float, r: float, line: float) -> float:
    k_max = int(math.floor(line))
    cdf = 0.0
    for k in range(k_max + 1):
        cdf += neg_bin_pmf(k, mu, r)
    return clamp(1.0 - cdf, 0.001, 0.999)


def devig_two_way(o1: float, o2: float) -> Tuple[float, float]:
    q1 = 1.0 / o1
    q2 = 1.0 / o2
    s = q1 + q2
    return clamp(q1 / s, 0.001, 0.999), clamp(q2 / s, 0.001, 0.999)


def devig_three_way(o_h: float, o_d: float, o_a: float) -> Tuple[float, float, float]:
    qh, qd, qa = 1.0 / o_h, 1.0 / o_d, 1.0 / o_a
    s = qh + qd + qa
    return clamp(qh / s, 0.001, 0.999), clamp(qd / s, 0.001, 0.999), clamp(qa / s, 0.001, 0.999)


def dutch_dc_odds(o1: float, o2: float, haircut: float = 0.985) -> float:
    # Exact 2-leg dutching odds adjusted by a realistic 1.5% bookmaker margin haircut
    return (1.0 / ((1.0 / o1) + (1.0 / o2))) * haircut


# ---------------------------------------------------------------------------
# Data Download & Parsing
# ---------------------------------------------------------------------------

def parse_float(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    s = val.strip()
    if not s:
        return None
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def parse_valid_odds(val: Optional[str]) -> Optional[float]:
    v = parse_float(val)
    if v is None or v <= 1.01 or v > 200.0:
        return None
    return v


def parse_csv_date(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return None
    s = raw.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def download_csv(season: str, div: str) -> List[Dict[str, str]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{season}_{div}.csv"
    ttl = 4 * 3600 if season == "2627" else 30 * 86400

    use_cache = False
    if cache_file.exists():
        age = time.time() - cache_file.stat().st_mtime
        if age < ttl:
            use_cache = True

    if use_cache:
        text = cache_file.read_text(encoding="utf-8-sig", errors="ignore")
    else:
        try:
            url = f"https://www.football-data.co.uk/mmz4281/{season}/{div}.csv"
            req = urllib.request.Request(url, headers=HTTP_HEADERS)
            with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
                raw_bytes = r.read()
            text = raw_bytes.decode("utf-8-sig", errors="ignore")
            cache_file.write_text(text, encoding="utf-8-sig")
        except Exception:
            if cache_file.exists():
                text = cache_file.read_text(encoding="utf-8-sig", errors="ignore")
            else:
                raise

    return list(csv.DictReader(io.StringIO(text)))


@dataclass
class MatchRow:
    league: str
    season: str
    match_date: date
    date_iso: str
    date_ord: int
    home: str
    away: str
    fthg: int
    ftag: int
    hc: Optional[float]
    ac: Optional[float]
    hs: Optional[float]
    as_: Optional[float]
    hst: Optional[float]
    ast: Optional[float]
    # Sharp de-vigged probabilities
    p_mkt_h: Optional[float]
    p_mkt_d: Optional[float]
    p_mkt_a: Optional[float]
    p_mkt_o25: Optional[float]
    # Playable odds for backtest ROI
    odds_o25: Optional[float]
    odds_u25: Optional[float]
    odds_1x: Optional[float]
    odds_x2: Optional[float]


def pick_first_odds(row: Dict[str, str], keys: List[str]) -> Optional[float]:
    for k in keys:
        v = parse_valid_odds(row.get(k))
        if v is not None:
            return v
    return None


def load_all_matches() -> List[MatchRow]:
    jobs = [(s, lg[0]) for s in SEASONS for lg in VERIFIED_LEAGUES]

    def _worker(job: Tuple[str, str]) -> Tuple[str, str, List[Dict[str, str]]]:
        s, div = job
        return s, div, download_csv(s, div)

    all_rows: List[MatchRow] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for season, div, rows in ex.map(_worker, jobs):
            for r in rows:
                home = (r.get("HomeTeam") or "").strip()
                away = (r.get("AwayTeam") or "").strip()
                dt = parse_csv_date(r.get("Date"))
                fthg = parse_float(r.get("FTHG"))
                ftag = parse_float(r.get("FTAG"))
                if not home or not away or dt is None or fthg is None or ftag is None:
                    continue

                hc = parse_float(r.get("HC"))
                ac = parse_float(r.get("AC"))
                hs = parse_float(r.get("HS"))
                as_ = parse_float(r.get("AS"))
                hst = parse_float(r.get("HST"))
                ast = parse_float(r.get("AST"))

                # Sharp 1X2 for market implied probs
                sh_h = pick_first_odds(r, ["BFEH", "AvgH", "PSH", "B365H"])
                sh_d = pick_first_odds(r, ["BFED", "AvgD", "PSD", "B365D"])
                sh_a = pick_first_odds(r, ["BFEA", "AvgA", "PSA", "B365A"])
                p_mkt_h = p_mkt_d = p_mkt_a = None
                if sh_h and sh_d and sh_a:
                    p_mkt_h, p_mkt_d, p_mkt_a = devig_three_way(sh_h, sh_d, sh_a)

                # Sharp O/U 2.5
                sh_o25 = pick_first_odds(r, ["BFE>2.5", "Avg>2.5", "P>2.5", "B365>2.5"])
                sh_u25 = pick_first_odds(r, ["BFE<2.5", "Avg<2.5", "P<2.5", "B365<2.5"])
                p_mkt_o25 = None
                if sh_o25 and sh_u25:
                    p_mkt_o25, _ = devig_two_way(sh_o25, sh_u25)

                # Playable bookmaker odds for backtest ROI (retail B365 -> Avg)
                bk_o25 = pick_first_odds(r, ["B365>2.5", "Avg>2.5", "BFE>2.5"])
                bk_u25 = pick_first_odds(r, ["B365<2.5", "Avg<2.5", "BFE<2.5"])
                bk_h = pick_first_odds(r, ["B365H", "AvgH", "BFEH"])
                bk_d = pick_first_odds(r, ["B365D", "AvgD", "BFED"])
                bk_a = pick_first_odds(r, ["B365A", "AvgA", "BFEA"])
                o1x = dutch_dc_odds(bk_h, bk_d) if (bk_h and bk_d) else None
                ox2 = dutch_dc_odds(bk_d, bk_a) if (bk_d and bk_a) else None

                all_rows.append(
                    MatchRow(
                        league=div,
                        season=season,
                        match_date=dt,
                        date_iso=dt.isoformat(),
                        date_ord=dt.toordinal(),
                        home=home,
                        away=away,
                        fthg=int(round(fthg)),
                        ftag=int(round(ftag)),
                        hc=hc,
                        ac=ac,
                        hs=hs,
                        as_=as_,
                        hst=hst,
                        ast=ast,
                        p_mkt_h=p_mkt_h,
                        p_mkt_d=p_mkt_d,
                        p_mkt_a=p_mkt_a,
                        p_mkt_o25=p_mkt_o25,
                        odds_o25=bk_o25,
                        odds_u25=bk_u25,
                        odds_1x=o1x,
                        odds_x2=ox2,
                    )
                )

    all_rows.sort(key=lambda m: (m.date_ord, m.league, m.home))
    return all_rows


# ---------------------------------------------------------------------------
# League Baselines (Strictly from Train Split)
# ---------------------------------------------------------------------------

def calibrate_league_baselines(matches: List[MatchRow]) -> Dict[str, Dict[str, float]]:
    train_by_lg: Dict[str, List[MatchRow]] = {}
    for m in matches:
        if m.date_iso < TRAIN_CUTOFF:
            train_by_lg.setdefault(m.league, []).append(m)

    baselines: Dict[str, Dict[str, float]] = {}
    for div, _, _ in VERIFIED_LEAGUES:
        rows = train_by_lg.get(div, [])
        if not rows:
            continue

        hg = [m.fthg for m in rows]
        ag = [m.ftag for m in rows]
        hc = [m.hc for m in rows if m.hc is not None and m.ac is not None]
        ac = [m.ac for m in rows if m.hc is not None and m.ac is not None]
        hs = [m.hs for m in rows if m.hs is not None and m.as_ is not None]
        as_ = [m.as_ for m in rows if m.hs is not None and m.as_ is not None]
        hst = [m.hst for m in rows if m.hst is not None and m.ast is not None]
        ast = [m.ast for m in rows if m.hst is not None and m.ast is not None]

        avg_hg = float(np.mean(hg))
        avg_ag = float(np.mean(ag))
        avg_hc = float(np.mean(hc)) if hc else 5.2
        avg_ac = float(np.mean(ac)) if ac else 4.5
        avg_hs = float(np.mean(hs)) if hs else 13.0
        avg_as = float(np.mean(as_)) if as_ else 11.0
        avg_hst = float(np.mean(hst)) if hst else 4.5
        avg_ast = float(np.mean(ast)) if ast else 3.8

        total_g = sum(hg) + sum(ag)
        total_sot = (sum(hst) + sum(ast)) if hst else max(1.0, len(rows) * 8.3)
        sot_conv = clamp(total_g / max(1.0, total_sot), 0.18, 0.45)

        # Negative Binomial dispersion r for total corners
        if hc:
            tot_c = np.array(hc) + np.array(ac)
            c_mean = float(np.mean(tot_c))
            c_var = float(np.var(tot_c, ddof=1))
            r_nb = clamp((c_mean ** 2) / max(0.5, c_var - c_mean), 4.0, 40.0)
        else:
            r_nb = 12.0

        # Goals <-> Corners empirical correlation
        gc_pairs = [(m.fthg + m.ftag, m.hc + m.ac) for m in rows if m.hc is not None and m.ac is not None]
        if len(gc_pairs) > 20:
            g_arr = np.array([p[0] for p in gc_pairs], dtype=float)
            c_arr = np.array([p[1] for p in gc_pairs], dtype=float)
            corr = float(np.corrcoef(g_arr, c_arr)[0, 1])
            if not math.isfinite(corr):
                corr = 0.05
            corr = clamp(corr, -0.25, 0.35)
        else:
            corr = 0.05

        # Calibrate Dixon-Coles rho on low scores (0-0, 1-0, 0-1, 1-1)
        best_rho = 0.0
        best_ll = 1e9
        for rho_candidate in np.linspace(-0.12, 0.12, 25):
            r_val = float(rho_candidate)
            # Check league-level low-score fit
            p_mat = dixon_coles_matrix(avg_hg, avg_ag, r_val, 8)
            # Log-likelihood proxy over actual outcomes
            ll = 0.0
            for m in rows:
                h_g, a_g = min(m.fthg, 8), min(m.ftag, 8)
                tau = max(0.05, dixon_coles_tau(h_g, a_g, avg_hg, avg_ag, r_val))
                p_cell = poisson_pmf(h_g, avg_hg) * poisson_pmf(a_g, avg_ag) * tau
                ll -= math.log(max(1e-6, p_cell))
            if ll < best_ll:
                best_ll = ll
                best_rho = r_val

        baselines[div] = {
            "avgHomeGoals": round(avg_hg, 5),
            "avgAwayGoals": round(avg_ag, 5),
            "avgHomeCorners": round(avg_hc, 5),
            "avgAwayCorners": round(avg_ac, 5),
            "avgHomeShots": round(avg_hs, 5),
            "avgAwayShots": round(avg_as, 5),
            "avgHomeSot": round(avg_hst, 5),
            "avgAwaySot": round(avg_ast, 5),
            "sotConversionRate": round(sot_conv, 5),
            "dcRho": round(best_rho, 4),
            "nbDispersion": round(r_nb, 4),
            "corrGC": round(corr, 4),
        }

    return baselines


# ---------------------------------------------------------------------------
# Chronological Feature Builder (Matched Exactly in TypeScript)
# ---------------------------------------------------------------------------

def decayed_mean(records: List[dict], field: str, as_of_ord: int, prior_mean: float) -> Tuple[float, float]:
    w_sum = 0.0
    wx_sum = 0.0
    for rec in records:
        val = rec[field]
        if val is None:
            continue
        days_ago = max(1, as_of_ord - rec["date_ord"])
        w = math.exp(-XI * days_ago)
        w_sum += w
        wx_sum += w * val
    est = (K_PRIOR * prior_mean + wx_sum) / (K_PRIOR + w_sum)
    return est, w_sum


def build_features_chronologically(
    matches: List[MatchRow],
    baselines: Dict[str, Dict[str, float]],
) -> List[dict]:
    # Per-league, per-team separated Home & Away history strictly prior to current date
    home_hist: Dict[Tuple[str, str], List[dict]] = {}
    away_hist: Dict[Tuple[str, str], List[dict]] = {}

    dataset: List[dict] = []

    # Process date-by-date to ensure ZERO same-day leakage
    idx = 0
    n = len(matches)
    while idx < n:
        cur_ord = matches[idx].date_ord
        day_end = idx
        while day_end < n and matches[day_end].date_ord == cur_ord:
            day_end += 1

        # 1. Build features for all matches on cur_ord using strictly prior history
        for k in range(idx, day_end):
            m = matches[k]
            lg = baselines.get(m.league)
            if not lg:
                continue

            h_recs = home_hist.get((m.league, m.home), [])
            a_recs = away_hist.get((m.league, m.away), [])

            h_gf, w_h = decayed_mean(h_recs, "gf", cur_ord, lg["avgHomeGoals"])
            h_ga, _ = decayed_mean(h_recs, "ga", cur_ord, lg["avgAwayGoals"])
            h_cf, _ = decayed_mean(h_recs, "cf", cur_ord, lg["avgHomeCorners"])
            h_ca, _ = decayed_mean(h_recs, "ca", cur_ord, lg["avgAwayCorners"])
            h_sf, _ = decayed_mean(h_recs, "sf", cur_ord, lg["avgHomeShots"])
            h_sa, _ = decayed_mean(h_recs, "sa", cur_ord, lg["avgAwayShots"])
            h_sotf, _ = decayed_mean(h_recs, "sotf", cur_ord, lg["avgHomeSot"])
            h_sota, _ = decayed_mean(h_recs, "sota", cur_ord, lg["avgAwaySot"])

            a_gf, w_a = decayed_mean(a_recs, "gf", cur_ord, lg["avgAwayGoals"])
            a_ga, _ = decayed_mean(a_recs, "ga", cur_ord, lg["avgHomeGoals"])
            a_cf, _ = decayed_mean(a_recs, "cf", cur_ord, lg["avgAwayCorners"])
            a_ca, _ = decayed_mean(a_recs, "ca", cur_ord, lg["avgHomeCorners"])
            a_sf, _ = decayed_mean(a_recs, "sf", cur_ord, lg["avgAwayShots"])
            a_sa, _ = decayed_mean(a_recs, "sa", cur_ord, lg["avgHomeShots"])
            a_sotf, _ = decayed_mean(a_recs, "sotf", cur_ord, lg["avgAwaySot"])
            a_sota, _ = decayed_mean(a_recs, "sota", cur_ord, lg["avgHomeSot"])

            conv = lg["sotConversionRate"]
            w_sot = SOT_BLEND_WEIGHT

            h_eff_gf = (1.0 - w_sot) * h_gf + w_sot * (h_sotf * conv)
            h_eff_ga = (1.0 - w_sot) * h_ga + w_sot * (h_sota * conv)
            a_eff_gf = (1.0 - w_sot) * a_gf + w_sot * (a_sotf * conv)
            a_eff_ga = (1.0 - w_sot) * a_ga + w_sot * (a_sota * conv)

            lg_eff_hg = (1.0 - w_sot) * lg["avgHomeGoals"] + w_sot * (lg["avgHomeSot"] * conv)
            lg_eff_ag = (1.0 - w_sot) * lg["avgAwayGoals"] + w_sot * (lg["avgAwaySot"] * conv)

            att_h = h_eff_gf / max(0.2, lg_eff_hg)
            def_a = a_eff_ga / max(0.2, lg_eff_hg)
            att_a = a_eff_gf / max(0.2, lg_eff_ag)
            def_h = h_eff_ga / max(0.2, lg_eff_ag)

            lam_h = clamp(att_h * def_a * lg["avgHomeGoals"], 0.25, 4.5)
            lam_a = clamp(att_a * def_h * lg["avgAwayGoals"], 0.25, 4.5)
            dc = dixon_coles_matrix(lam_h, lam_a, lg["dcRho"])

            has_odds = (
                m.p_mkt_o25 is not None
                and m.p_mkt_h is not None
                and m.p_mkt_d is not None
                and m.p_mkt_a is not None
            )
            if has_odds:
                abs_dom = abs(m.p_mkt_h - m.p_mkt_a)  # type: ignore[operator]
                logit_mkt_o25 = safe_logit(m.p_mkt_o25)  # type: ignore[arg-type]
                logit_mkt_1x = safe_logit(m.p_mkt_h + m.p_mkt_d)  # type: ignore[operator]
                logit_mkt_x2 = safe_logit(m.p_mkt_d + m.p_mkt_a)  # type: ignore[operator]
            else:
                abs_dom = abs(dc["pH"] - dc["pA"])
                logit_mkt_o25 = 0.0
                logit_mkt_1x = 0.0
                logit_mkt_x2 = 0.0

            # Corners Lambda (75% real corners H/A + 25% shot volume pressure) * dominance boost
            c_att_h = h_cf / max(1.0, lg["avgHomeCorners"])
            c_def_a = a_ca / max(1.0, lg["avgHomeCorners"])
            c_att_a = a_cf / max(1.0, lg["avgAwayCorners"])
            c_def_h = h_ca / max(1.0, lg["avgAwayCorners"])

            s_att_h = h_sf / max(2.0, lg["avgHomeShots"])
            s_def_a = a_sa / max(2.0, lg["avgHomeShots"])
            s_att_a = a_sf / max(2.0, lg["avgAwayShots"])
            s_def_h = h_sa / max(2.0, lg["avgAwayShots"])

            dom_mult = 1.0 + 0.08 * abs_dom
            lam_ch = clamp(
                (0.75 * (c_att_h * c_def_a) + 0.25 * (s_att_h * s_def_a)) * lg["avgHomeCorners"] * dom_mult,
                2.0,
                11.0,
            )
            lam_ca = clamp(
                (0.75 * (c_att_a * c_def_h) + 0.25 * (s_att_a * s_def_h)) * lg["avgAwayCorners"] * dom_mult,
                1.5,
                10.0,
            )
            lam_c_tot = lam_ch + lam_ca

            nb_o65 = prob_over_neg_bin(lam_c_tot, lg["nbDispersion"], 6.5)
            nb_o75 = prob_over_neg_bin(lam_c_tot, lg["nbDispersion"], 7.5)
            nb_o85 = prob_over_neg_bin(lam_c_tot, lg["nbDispersion"], 8.5)

            sot_exp = (
                (h_sotf / max(1.0, lg["avgHomeSot"])) * (a_sota / max(1.0, lg["avgHomeSot"])) * lg["avgHomeSot"]
                + (a_sotf / max(1.0, lg["avgAwaySot"])) * (h_sota / max(1.0, lg["avgAwaySot"])) * lg["avgAwaySot"]
            )
            shots_exp = (s_att_h * s_def_a * lg["avgHomeShots"]) + (s_att_a * s_def_h * lg["avgAwayShots"])

            eff_played = (2.0 * w_h * w_a) / max(0.5, w_h + w_a)
            sample_conf = clamp(eff_played / 12.0, 0.0, 1.0)

            base_tail = [
                logit_mkt_o25,
                logit_mkt_1x,
                logit_mkt_x2,
                lam_h + lam_a,
                lam_h - lam_a,
                sot_exp,
                shots_exp,
                lam_c_tot,
                abs_dom,
                1.0 if has_odds else 0.0,
                sample_conf,
            ]

            features_by_target = {
                "GOALS_O15": [safe_logit(dc["pO15"])] + base_tail,
                "GOALS_O25": [safe_logit(dc["pO25"])] + base_tail,
                "CORNERS_O65": [safe_logit(nb_o65)] + base_tail,
                "CORNERS_O75": [safe_logit(nb_o75)] + base_tail,
                "DC_1X": [safe_logit(dc["p1X"])] + base_tail,
                "DC_X2": [safe_logit(dc["pX2"])] + base_tail,
                "DC1X_O15": [safe_logit(dc["p1XO15"])] + base_tail,
                "DCX2_O15": [safe_logit(dc["pX2O15"])] + base_tail,
                "HOME_O15": [safe_logit(dc["pHomeO15"])] + base_tail,
                "CORNERS_O85": [safe_logit(nb_o85)] + base_tail,
            }

            tot_g = m.fthg + m.ftag
            has_corners = m.hc is not None and m.ac is not None
            tot_c = (m.hc + m.ac) if has_corners else None

            dataset.append(
                {
                    "match": m,
                    "features": features_by_target,
                    "domainProbs": {
                        "GOALS_O15": dc["pO15"],
                        "GOALS_O25": dc["pO25"],
                        "CORNERS_O65": nb_o65,
                        "CORNERS_O75": nb_o75,
                        "DC_1X": dc["p1X"],
                        "DC_X2": dc["pX2"],
                        "DC1X_O15": dc["p1XO15"],
                        "DCX2_O15": dc["pX2O15"],
                        "HOME_O15": dc["pHomeO15"],
                        "CORNERS_O85": nb_o85,
                    },
                    "labels": {
                        "GOALS_O15": 1 if tot_g > 1.5 else 0,
                        "GOALS_O25": 1 if tot_g > 2.5 else 0,
                        "CORNERS_O65": (1 if tot_c > 6.5 else 0) if tot_c is not None else None,
                        "CORNERS_O75": (1 if tot_c > 7.5 else 0) if tot_c is not None else None,
                        "DC_1X": 1 if m.fthg >= m.ftag else 0,
                        "DC_X2": 1 if m.ftag >= m.fthg else 0,
                        "DC1X_O15": 1 if (m.fthg >= m.ftag and tot_g >= 2) else 0,
                        "DCX2_O15": 1 if (m.ftag >= m.fthg and tot_g >= 2) else 0,
                        "HOME_O15": 1 if m.fthg >= 2 else 0,
                        "CORNERS_O85": (1 if tot_c >= 9 else 0) if tot_c is not None else None,
                    },
                    "rawTeamStats": {
                        "h_gf": h_gf, "h_ga": h_ga, "h_cf": h_cf, "h_ca": h_ca,
                        "h_sf": h_sf, "h_sa": h_sa, "h_sotf": h_sotf, "h_sota": h_sota,
                        "a_gf": a_gf, "a_ga": a_ga, "a_cf": a_cf, "a_ca": a_ca,
                        "a_sf": a_sf, "a_sa": a_sa, "a_sotf": a_sotf, "a_sota": a_sota,
                        "w_h": w_h, "w_a": w_a,
                        "lam_h": lam_h, "lam_a": lam_a, "lam_ch": lam_ch, "lam_ca": lam_ca,
                    },
                }
            )

        # 2. Update history AFTER all matches on cur_ord are processed
        for k in range(idx, day_end):
            m = matches[k]
            home_hist.setdefault((m.league, m.home), []).append(
                {
                    "date_ord": cur_ord,
                    "gf": float(m.fthg),
                    "ga": float(m.ftag),
                    "cf": m.hc,
                    "ca": m.ac,
                    "sf": m.hs,
                    "sa": m.as_,
                    "sotf": m.hst,
                    "sota": m.ast,
                }
            )
            away_hist.setdefault((m.league, m.away), []).append(
                {
                    "date_ord": cur_ord,
                    "gf": float(m.ftag),
                    "ga": float(m.fthg),
                    "cf": m.ac,
                    "ca": m.hc,
                    "sf": m.as_,
                    "sa": m.hs,
                    "sotf": m.ast,
                    "sota": m.hst,
                }
            )

        idx = day_end

    return dataset


# ---------------------------------------------------------------------------
# Pure-NumPy ML Models: L2 Logistic Regression & Shallow GBDT + Platt
# ---------------------------------------------------------------------------

def fit_l2_logistic(X: np.ndarray, y: np.ndarray, l2: float = 15.0, n_iter: int = 30) -> Tuple[np.ndarray, float]:
    n, d = X.shape
    w = np.zeros(d, dtype=np.float64)
    p0 = clamp(float(np.mean(y)), 0.01, 0.99)
    b = math.log(p0 / (1.0 - p0))

    eye_d = np.eye(d + 1, dtype=np.float64)
    eye_d[-1, -1] = 0.0  # Do not regularize bias
    X_aug = np.column_stack([X, np.ones(n, dtype=np.float64)])
    theta = np.append(w, b)

    for _ in range(n_iter):
        z = X_aug @ theta
        p = sigmoid_arr(z)
        h = np.maximum(p * (1.0 - p), 1e-6)
        grad = X_aug.T @ (p - y) + l2 * (eye_d @ theta)
        hess = (X_aug.T * h) @ X_aug + l2 * eye_d + 1e-6 * np.eye(d + 1)
        step = np.linalg.solve(hess, grad)
        theta -= step
        if float(np.max(np.abs(step))) < 1e-6:
            break

    return theta[:-1], float(theta[-1])


def fit_gbdt_binary(
    X: np.ndarray,
    y: np.ndarray,
    n_trees: int = 35,
    max_depth: int = 2,
    lr: float = 0.06,
    reg_lambda: float = 25.0,
    min_leaf_samples: int = 60,
    min_child_hess: float = 20.0,
) -> Tuple[float, List[dict]]:
    p0 = clamp(float(np.mean(y)), 0.01, 0.99)
    init_score = math.log(p0 / (1.0 - p0))
    n, d = X.shape
    preds = np.full(n, init_score, dtype=np.float64)

    # Precompute candidate split thresholds (24 quantiles per feature)
    thresholds: List[np.ndarray] = []
    qs = np.linspace(0.04, 0.96, 24)
    for j in range(d):
        col = X[:, j]
        if float(np.std(col)) < 1e-9:
            thresholds.append(np.array([], dtype=np.float64))
        else:
            thresholds.append(np.unique(np.quantile(col, qs)))

    def build_node(mask_idx: np.ndarray, g: np.ndarray, h: np.ndarray, depth: int) -> dict:
        g_sub = g[mask_idx]
        h_sub = h[mask_idx]
        g_tot = float(np.sum(g_sub))
        h_tot = float(np.sum(h_sub))
        leaf_val = clamp(-g_tot / (h_tot + reg_lambda), -2.5, 2.5)

        if depth >= max_depth or len(mask_idx) < 2 * min_leaf_samples:
            return {"v": round(leaf_val, 6)}

        parent_score = (g_tot * g_tot) / (h_tot + reg_lambda)
        best_gain = 1e-4
        best_feat = -1
        best_thr = 0.0
        best_left: Optional[np.ndarray] = None
        best_right: Optional[np.ndarray] = None

        X_sub = X[mask_idx]
        for j in range(d):
            thrs = thresholds[j]
            if len(thrs) == 0:
                continue
            col = X_sub[:, j]
            for thr in thrs:
                left_mask = col <= thr
                n_l = int(np.sum(left_mask))
                n_r = len(mask_idx) - n_l
                if n_l < min_leaf_samples or n_r < min_leaf_samples:
                    continue
                g_l = float(np.sum(g_sub[left_mask]))
                h_l = float(np.sum(h_sub[left_mask]))
                g_r = g_tot - g_l
                h_r = h_tot - h_l
                if h_l < min_child_hess or h_r < min_child_hess:
                    continue
                gain = 0.5 * (
                    (g_l * g_l) / (h_l + reg_lambda)
                    + (g_r * g_r) / (h_r + reg_lambda)
                    - parent_score
                )
                if gain > best_gain:
                    best_gain = gain
                    best_feat = j
                    best_thr = float(thr)
                    best_left = mask_idx[left_mask]
                    best_right = mask_idx[~left_mask]

        if best_feat == -1 or best_left is None or best_right is None:
            return {"v": round(leaf_val, 6)}

        return {
            "f": best_feat,
            "t": round(best_thr, 6),
            "l": build_node(best_left, g, h, depth + 1),
            "r": build_node(best_right, g, h, depth + 1),
        }

    all_idx = np.arange(n)
    trees: List[dict] = []
    for _ in range(n_trees):
        p = sigmoid_arr(preds)
        g = p - y
        h = np.maximum(p * (1.0 - p), 1e-5)
        tree = build_node(all_idx, g, h, 0)
        trees.append(tree)
        # Apply tree vector predictions
        tree_out = eval_gbdt_tree_vec(tree, X)
        preds += lr * tree_out

    return round(init_score, 6), trees


def eval_gbdt_tree_single(node: dict, x: List[float]) -> float:
    cur = node
    while "v" not in cur:
        cur = cur["l"] if x[cur["f"]] <= cur["t"] else cur["r"]
    return float(cur["v"])


def eval_gbdt_tree_vec(node: dict, X: np.ndarray) -> np.ndarray:
    if "v" in node:
        return np.full(X.shape[0], float(node["v"]), dtype=np.float64)
    mask = X[:, node["f"]] <= node["t"]
    out = np.empty(X.shape[0], dtype=np.float64)
    if np.any(mask):
        out[mask] = eval_gbdt_tree_vec(node["l"], X[mask])
    if np.any(~mask):
        out[~mask] = eval_gbdt_tree_vec(node["r"], X[~mask])
    return out


def predict_gbdt_vec(init_score: float, lr: float, trees: List[dict], X: np.ndarray) -> np.ndarray:
    scores = np.full(X.shape[0], init_score, dtype=np.float64)
    for t in trees:
        scores += lr * eval_gbdt_tree_vec(t, X)
    return sigmoid_arr(scores)


def fit_platt_calibration(logits: np.ndarray, y: np.ndarray) -> Tuple[float, float]:
    # Fit p = sigmoid(a * logit + b) with tiny regularization around a=1, b=0
    a, b = 1.0, 0.0
    for _ in range(25):
        z = a * logits + b
        p = sigmoid_arr(z)
        h = np.maximum(p * (1.0 - p), 1e-6)
        err = p - y
        g_a = float(np.sum(err * logits)) + 2.0 * (a - 1.0)
        g_b = float(np.sum(err)) + 2.0 * b
        h_aa = float(np.sum(h * logits * logits)) + 2.0
        h_ab = float(np.sum(h * logits))
        h_bb = float(np.sum(h)) + 2.0
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-9:
            break
        da = (h_bb * g_a - h_ab * g_b) / det
        db = (-h_ab * g_a + h_aa * g_b) / det
        a -= da
        b -= db
        if max(abs(da), abs(db)) < 1e-6:
            break
    return round(clamp(a, 0.3, 2.0), 6), round(clamp(b, -1.5, 1.5), 6)


def brier_and_logloss(y: np.ndarray, p: np.ndarray) -> Tuple[float, float]:
    pc = np.clip(p, 1e-5, 1.0 - 1e-5)
    brier = float(np.mean((pc - y) ** 2))
    ll = float(-np.mean(y * np.log(pc) + (1.0 - y) * np.log(1.0 - pc)))
    return brier, ll


# ---------------------------------------------------------------------------
# Main Training, Calibration & Out-of-Sample Walk-Forward Backtest
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    print("=== SPFIA v4 — Entrenamiento Multi-Liga y Backtest Out-of-Sample (26/27) ===")
    matches = load_all_matches()
    print(f"Partidos cargados (24/25 + 25/26 + 26/27): {len(matches)} en {len(VERIFIED_LEAGUES)} ligas.")

    baselines = calibrate_league_baselines(matches)
    print(f"Baselines de {len(baselines)} ligas calibrados estrictamente con Train (< {TRAIN_CUTOFF}).")

    dataset = build_features_chronologically(matches, baselines)
    print(f"Dataset cronologico sin fuga generado: {len(dataset)} filas.")

    targets_export: Dict[str, dict] = {}
    backtest_summary: Dict[str, dict] = {}

    # Also store predicted probabilities on test rows for joint/tier evaluation
    test_probs_by_row: Dict[int, Dict[str, float]] = {}

    for target in TARGETS:
        train_rows = [d for d in dataset if d["match"].date_iso < TRAIN_CUTOFF and d["labels"][target] is not None]
        cal_rows = [d for d in dataset if TRAIN_CUTOFF <= d["match"].date_iso < TEST_CUTOFF and d["labels"][target] is not None]
        test_rows = [d for d in dataset if d["match"].date_iso >= TEST_CUTOFF and d["labels"][target] is not None]

        X_tr_raw = np.array([d["features"][target] for d in train_rows], dtype=np.float64)
        y_tr = np.array([d["labels"][target] for d in train_rows], dtype=np.float64)

        X_cal_raw = np.array([d["features"][target] for d in cal_rows], dtype=np.float64)
        y_cal = np.array([d["labels"][target] for d in cal_rows], dtype=np.float64)

        X_te_raw = np.array([d["features"][target] for d in test_rows], dtype=np.float64)
        y_te = np.array([d["labels"][target] for d in test_rows], dtype=np.float64)

        means = np.mean(X_tr_raw, axis=0)
        stds = np.maximum(np.std(X_tr_raw, axis=0), 1e-4)

        X_tr = (X_tr_raw - means) / stds
        X_cal = (X_cal_raw - means) / stds
        X_te = (X_te_raw - means) / stds

        # 1. L2 Logistic Regression (with odds)
        lr_w, lr_b = fit_l2_logistic(X_tr, y_tr, l2=25.0)
        # 2. L2 Logistic Regression (no-odds fallback: zero out columns 1,2,3,10 in raw features)
        X_tr_noodds_raw = X_tr_raw.copy()
        X_tr_noodds_raw[:, [1, 2, 3, 10]] = 0.0
        X_tr_noodds = (X_tr_noodds_raw - means) / stds
        no_w, no_b = fit_l2_logistic(X_tr_noodds, y_tr, l2=25.0)

        # 3. Shallow GBDT (35 depth-2 trees)
        gbdt_lr = 0.06
        gbdt_init, gbdt_trees = fit_gbdt_binary(X_tr, y_tr, n_trees=35, max_depth=2, lr=gbdt_lr)

        # 4. Find optimal ensemble blend weight w_lr on calibration split
        p_cal_lr = sigmoid_arr(X_cal @ lr_w + lr_b)
        p_cal_gb = predict_gbdt_vec(gbdt_init, gbdt_lr, gbdt_trees, X_cal)

        best_blend = 0.5
        best_a, best_b = 1.0, 0.0
        best_cal_ll = 1e9
        for w_lr_cand in np.linspace(0.0, 1.0, 21):
            wc = float(w_lr_cand)
            p_mix = np.clip(wc * p_cal_lr + (1.0 - wc) * p_cal_gb, 1e-4, 1.0 - 1e-4)
            logits_mix = np.log(p_mix / (1.0 - p_mix))
            a_c, b_c = fit_platt_calibration(logits_mix, y_cal)
            p_platt = sigmoid_arr(a_c * logits_mix + b_c)
            _, ll_c = brier_and_logloss(y_cal, p_platt)
            if ll_c < best_cal_ll:
                best_cal_ll = ll_c
                best_blend = round(wc, 2)
                best_a, best_b = a_c, b_c

        # Evaluate strictly Out-of-Sample on 26/27 Test split
        p_te_lr = sigmoid_arr(X_te @ lr_w + lr_b)
        p_te_gb = predict_gbdt_vec(gbdt_init, gbdt_lr, gbdt_trees, X_te)
        p_te_mix = np.clip(best_blend * p_te_lr + (1.0 - best_blend) * p_te_gb, 1e-4, 1.0 - 1e-4)
        logits_te = np.log(p_te_mix / (1.0 - p_te_mix))
        p_te_final = sigmoid_arr(best_a * logits_te + best_b)

        p_dom_te = np.array([d["domainProbs"][target] for d in test_rows], dtype=np.float64)
        brier_mod, ll_mod = brier_and_logloss(y_te, p_te_final)
        brier_dom, ll_dom = brier_and_logloss(y_te, p_dom_te)

        # Save predictions keyed by dataset index for multi-market reporting
        test_indices = [i for i, d in enumerate(dataset) if d["match"].date_iso >= TEST_CUTOFF and d["labels"][target] is not None]
        for row_idx, prob_val in zip(test_indices, p_te_final):
            test_probs_by_row.setdefault(row_idx, {})[target] = float(prob_val)

        # Reliability buckets on 26/27 test split
        buckets = {}
        for label, lo, hi in [("65-70%", 0.65, 0.70), ("70-75%", 0.70, 0.75), ("75-80%", 0.75, 0.80), ("80-85%", 0.80, 0.85), ("85%+", 0.85, 1.01)]:
            mask = (p_te_final >= lo) & (p_te_final < hi)
            cnt = int(np.sum(mask))
            if cnt > 0:
                buckets[label] = {
                    "count": cnt,
                    "predAvg": round(float(np.mean(p_te_final[mask])), 4),
                    "actualHitRate": round(float(np.mean(y_te[mask])), 4),
                }

        backtest_summary[target] = {
            "testCount": len(test_rows),
            "baseRate": round(float(np.mean(y_te)), 4),
            "modelBrier": round(brier_mod, 5),
            "domainBrier": round(brier_dom, 5),
            "modelLogLoss": round(ll_mod, 5),
            "domainLogLoss": round(ll_dom, 5),
            "blendWeightLR": best_blend,
            "calibrationBuckets": buckets,
        }

        targets_export[target] = {
            "featureMeans": [round(float(v), 6) for v in means],
            "featureStds": [round(float(v), 6) for v in stds],
            "logisticWeights": [round(float(v), 6) for v in lr_w],
            "logisticBias": round(lr_b, 6),
            "noOddsWeights": [round(float(v), 6) for v in no_w],
            "noOddsBias": round(no_b, 6),
            "gbdtInit": gbdt_init,
            "gbdtLr": gbdt_lr,
            "gbdtTrees": gbdt_trees,
            "blendWeight": best_blend,
            "plattA": best_a,
            "plattB": best_b,
        }

    # --- Market-Specific & EV ROI Backtest Report on 26/27 Season ---
    # Check GOALS_O15 & CORNERS tiers, plus GOALS_OU25 & DOUBLE_CHANCE EV+ betting ROI
    ou25_bets = []
    dc_bets = []
    tier_stats = {
        "GOALS_O15_S": [0, 0], "GOALS_O15_A": [0, 0],
        "CORNERS_O65_S": [0, 0], "CORNERS_O65_A": [0, 0],
        "CORNERS_O75_S": [0, 0], "CORNERS_O75_A": [0, 0],
        "DC_S": [0, 0], "DC_A": [0, 0],
        "COMBO_DC_O15_S": [0, 0], "COMBO_DC_O15_A": [0, 0],
        "HOME_O15_S": [0, 0], "HOME_O15_A": [0, 0],
        "CORNERS_O85_S": [0, 0], "CORNERS_O85_A": [0, 0],
    }

    for row_idx, probs in test_probs_by_row.items():
        d = dataset[row_idx]
        m: MatchRow = d["match"]
        labels = d["labels"]

        if "GOALS_O15" in probs:
            p = probs["GOALS_O15"]
            y = labels["GOALS_O15"]
            if p >= 0.82:
                tier_stats["GOALS_O15_S"][0] += y
                tier_stats["GOALS_O15_S"][1] += 1
            elif p >= 0.76:
                tier_stats["GOALS_O15_A"][0] += y
                tier_stats["GOALS_O15_A"][1] += 1

        if "CORNERS_O65" in probs and labels["CORNERS_O65"] is not None:
            p = probs["CORNERS_O65"]
            y = labels["CORNERS_O65"]
            if p >= 0.85:
                tier_stats["CORNERS_O65_S"][0] += y
                tier_stats["CORNERS_O65_S"][1] += 1
            elif p >= 0.80:
                tier_stats["CORNERS_O65_A"][0] += y
                tier_stats["CORNERS_O65_A"][1] += 1

        if "CORNERS_O75" in probs and labels["CORNERS_O75"] is not None:
            p = probs["CORNERS_O75"]
            y = labels["CORNERS_O75"]
            if p >= 0.80:
                tier_stats["CORNERS_O75_S"][0] += y
                tier_stats["CORNERS_O75_S"][1] += 1
            elif p >= 0.75:
                tier_stats["CORNERS_O75_A"][0] += y
                tier_stats["CORNERS_O75_A"][1] += 1

        if "DC_1X" in probs and "DC_X2" in probs:
            best_dc_p = probs["DC_1X"] if probs["DC_1X"] >= probs["DC_X2"] else probs["DC_X2"]
            best_dc_y = labels["DC_1X"] if probs["DC_1X"] >= probs["DC_X2"] else labels["DC_X2"]
            if best_dc_p >= 0.85:
                tier_stats["DC_S"][0] += best_dc_y
                tier_stats["DC_S"][1] += 1
            elif best_dc_p >= 0.78:
                tier_stats["DC_A"][0] += best_dc_y
                tier_stats["DC_A"][1] += 1

        if "DC1X_O15" in probs and "DCX2_O15" in probs:
            p_c1x, p_cx2 = probs["DC1X_O15"], probs["DCX2_O15"]
            best_cp = p_c1x if p_c1x >= p_cx2 else p_cx2
            best_cy = labels["DC1X_O15"] if p_c1x >= p_cx2 else labels["DCX2_O15"]
            if best_cp >= 0.72:
                tier_stats["COMBO_DC_O15_S"][0] += best_cy
                tier_stats["COMBO_DC_O15_S"][1] += 1
            elif best_cp >= 0.65:
                tier_stats["COMBO_DC_O15_A"][0] += best_cy
                tier_stats["COMBO_DC_O15_A"][1] += 1

        if "HOME_O15" in probs:
            p_ho = probs["HOME_O15"]
            y_ho = labels["HOME_O15"]
            if p_ho >= 0.70:
                tier_stats["HOME_O15_S"][0] += y_ho
                tier_stats["HOME_O15_S"][1] += 1
            elif p_ho >= 0.65:
                tier_stats["HOME_O15_A"][0] += y_ho
                tier_stats["HOME_O15_A"][1] += 1

        if "CORNERS_O85" in probs and labels["CORNERS_O85"] is not None:
            p_c85 = probs["CORNERS_O85"]
            y_c85 = labels["CORNERS_O85"]
            if p_c85 >= 0.72:
                tier_stats["CORNERS_O85_S"][0] += y_c85
                tier_stats["CORNERS_O85_S"][1] += 1
            elif p_c85 >= 0.68:
                tier_stats["CORNERS_O85_A"][0] += y_c85
                tier_stats["CORNERS_O85_A"][1] += 1

        # Real EV+ bets on GOALS_OU25
        if "GOALS_O25" in probs and m.odds_o25 and m.odds_u25:
            p_o = probs["GOALS_O25"]
            p_u = 1.0 - p_o
            ev_o = p_o * m.odds_o25 - 1.0
            ev_u = p_u * m.odds_u25 - 1.0
            if ev_o >= ev_u and ev_o >= 0.03 and p_o >= 0.55:
                kelly_f = 0.25 * (ev_o / (m.odds_o25 - 1.0))
                stake = clamp(round(kelly_f * 100.0 * 2.0) / 2.0, 0.5, 5.0)
                won = labels["GOALS_O25"] == 1
                ou25_bets.append((stake, stake * (m.odds_o25 - 1.0) if won else -stake, 1 if won else 0, ev_o, p_o, m.odds_o25))
            elif ev_u > ev_o and ev_u >= 0.03 and p_u >= 0.55:
                kelly_f = 0.25 * (ev_u / (m.odds_u25 - 1.0))
                stake = clamp(round(kelly_f * 100.0 * 2.0) / 2.0, 0.5, 5.0)
                won = labels["GOALS_O25"] == 0
                ou25_bets.append((stake, stake * (m.odds_u25 - 1.0) if won else -stake, 1 if won else 0, ev_u, p_u, m.odds_u25))

        # Real EV+ bets on DOUBLE_CHANCE (high-confidence 1X/X2 with positive EV)
        if "DC_1X" in probs and "DC_X2" in probs and m.odds_1x and m.odds_x2:
            p_1x, p_x2 = probs["DC_1X"], probs["DC_X2"]
            ev_1x = p_1x * m.odds_1x - 1.0
            ev_x2 = p_x2 * m.odds_x2 - 1.0
            if ev_1x >= ev_x2 and ev_1x >= 0.025 and p_1x >= 0.78:
                kelly_f = 0.25 * (ev_1x / (m.odds_1x - 1.0))
                stake = clamp(round(kelly_f * 100.0 * 2.0) / 2.0, 0.5, 5.0)
                won = labels["DC_1X"] == 1
                dc_bets.append((stake, stake * (m.odds_1x - 1.0) if won else -stake, 1 if won else 0, ev_1x, p_1x, m.odds_1x))
            elif ev_x2 > ev_1x and ev_x2 >= 0.025 and p_x2 >= 0.78:
                kelly_f = 0.25 * (ev_x2 / (m.odds_x2 - 1.0))
                stake = clamp(round(kelly_f * 100.0 * 2.0) / 2.0, 0.5, 5.0)
                won = labels["DC_X2"] == 1
                dc_bets.append((stake, stake * (m.odds_x2 - 1.0) if won else -stake, 1 if won else 0, ev_x2, p_x2, m.odds_x2))

    def summarize_bets(bets: List[tuple]) -> dict:
        if not bets:
            return {"bets": 0, "hitRate": 0.0, "staked": 0.0, "profit": 0.0, "roi": 0.0, "avgOdds": 0.0}
        tot_stake = sum(b[0] for b in bets)
        tot_prof = sum(b[1] for b in bets)
        wins = sum(b[2] for b in bets)
        avg_odds = sum(b[5] for b in bets) / len(bets)
        return {
            "bets": len(bets),
            "hitRate": round(wins / len(bets), 4),
            "staked": round(tot_stake, 2),
            "profit": round(tot_prof, 2),
            "roi": round(tot_prof / max(1e-6, tot_stake), 4),
            "avgOdds": round(avg_odds, 3),
        }

    ev_summary = {
        "GOALS_OU25": summarize_bets(ou25_bets),
        "DOUBLE_CHANCE": summarize_bets(dc_bets),
        "TIERS": {
            k: {"wins": v[0], "total": v[1], "hitRate": round(v[0] / max(1, v[1]), 4)}
            for k, v in tier_stats.items()
        },
    }

    # Build 5 deterministic Parity Checks from late 26/27 test matches
    parity_checks: List[dict] = []
    candidate_indices = [i for i in sorted(test_probs_by_row.keys()) if len(test_probs_by_row[i]) == len(TARGETS)]
    step = max(1, len(candidate_indices) // 5)
    for r_i in candidate_indices[-5:]:
        d = dataset[r_i]
        m = d["match"]
        raw = d["rawTeamStats"]
        parity_checks.append(
            {
                "league": m.league,
                "date": m.date_iso,
                "homeTeam": m.home,
                "awayTeam": m.away,
                "hasMarketOdds": bool(d["features"]["GOALS_O15"][10] > 0.5),
                "pMktH": round(m.p_mkt_h, 6) if m.p_mkt_h is not None else None,
                "pMktD": round(m.p_mkt_d, 6) if m.p_mkt_d is not None else None,
                "pMktA": round(m.p_mkt_a, 6) if m.p_mkt_a is not None else None,
                "pMktO25": round(m.p_mkt_o25, 6) if m.p_mkt_o25 is not None else None,
                "teamSnapshot": {k: round(v, 6) for k, v in raw.items()},
                "features": {t: [round(x, 6) for x in d["features"][t]] for t in TARGETS},
                "expectedProbs": {t: round(test_probs_by_row[r_i][t], 6) for t in TARGETS},
            }
        )

    export_payload = {
        "version": "5.0.0",
        "trainedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "seasons": SEASONS,
        "trainCutoff": TRAIN_CUTOFF,
        "testCutoff": TEST_CUTOFF,
        "totalMatchesTrained": len([d for d in dataset if d["match"].date_iso < TEST_CUTOFF]),
        "totalMatchesTested": len(test_probs_by_row),
        "xi": XI,
        "kPrior": K_PRIOR,
        "sotBlendWeight": SOT_BLEND_WEIGHT,
        "leagues": baselines,
        "targets": targets_export,
        "backtestSummary": backtest_summary,
        "evSummary": ev_summary,
        "parityChecks": parity_checks,
    }

    OUTPUT_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MODEL_PATH.write_text(json.dumps(export_payload, indent=2), encoding="utf-8")

    # Print Human-Readable Out-of-Sample Report
    print("\n--- RESULTADOS BACKTEST OUT-OF-SAMPLE (TEMPORADA 2026/27 NO VISTA) ---")
    for t, info in backtest_summary.items():
        print(
            f"  {t:12s} | N={info['testCount']:4d} | Base={info['baseRate']*100:5.1f}% | "
            f"Brier Modelo={info['modelBrier']:.5f} vs Dominio={info['domainBrier']:.5f} | "
            f"LL={info['modelLogLoss']:.5f} vs Dom={info['domainLogLoss']:.5f} | w_LR={info['blendWeightLR']}"
        )
        b_str = " | ".join(
            f"{k}: n={v['count']}, pred={v['predAvg']*100:.1f}%, real={v['actualHitRate']*100:.1f}%"
            for k, v in info["calibrationBuckets"].items()
        )
        if b_str:
            print(f"    Calibración: {b_str}")

    print("\n--- RENDIMIENTO TIERS & EV+ REAL (CUOTAS B365/AVG, KELLY 0.25x) ---")
    for k, v in ev_summary["TIERS"].items():
        print(f"  {k:15s}: {v['wins']:4d}/{v['total']:4d} ({v['hitRate']*100:5.1f}%)")
    for mkt in ("GOALS_OU25", "DOUBLE_CHANCE"):
        v = ev_summary[mkt]
        print(
            f"  {mkt:15s} EV+: bets={v['bets']:3d}, hit={v['hitRate']*100:5.1f}%, "
            f"avgOdds={v['avgOdds']:.2f}, profit={v['profit']:+.2f}u, ROI={v['roi']*100:+.2f}%"
        )

    print(f"\nModelo calibrado guardado en: {OUTPUT_MODEL_PATH} ({time.time() - t0:.2f}s)")


if __name__ == "__main__":
    main()
