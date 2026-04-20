import { useState, useMemo } from "react";

// ─── MARKET ASSUMPTIONS (user-specified + USDA context) ───
const ASSUMPTIONS = {
  milkPricePerCwt: 19.00,
  discountRate: 0.08,
  projectionYears: 5,
  cullValuePerLb: 1.20,
  cullCowWeightLbs: 1400,
  heiferRaisingCostPerDay: 3.25,

  // ── HERD-SPECIFIC LACTATION CURVE (DHI data, milk lbs and feed cost by stage) ──
  // Source: User's actual herd production and feed cost records.
  // IOFC is recalculated dynamically based on current milk price slider.
  // Cow lactation: 340 days, ~33,900 lbs, ~99.7 lbs/d average
  // Heifer lactation: 330 days, ~29,040 lbs, ~88 lbs/d average
  lactationCurve: {
    cow: [  // 2nd+ lactation (grouped together)
      { stage: "fresh",    days: 40,  milkLbs: 90,  feedCost: 8.00  },
      { stage: "peak",     days: 120, milkLbs: 125, feedCost: 11.68 },
      { stage: "mid",      days: 60,  milkLbs: 105, feedCost: 11.68 },
      { stage: "late",     days: 60,  milkLbs: 85,  feedCost: 8.96  },
      { stage: "far_late", days: 60,  milkLbs: 65,  feedCost: 9.63  },
    ],
    heifer: [  // 1st lactation
      { stage: "fresh", days: 40,  milkLbs: 80, feedCost: 8.63 },
      { stage: "peak",  days: 170, milkLbs: 98, feedCost: 9.85 },
      { stage: "mid",   days: 60,  milkLbs: 85, feedCost: 9.85 },
      { stage: "late",  days: 60,  milkLbs: 68, feedCost: 8.63 },
    ],
  },

  // ── Dry period feed costs (two-stage: far-off + close-up) ──
  // User-specified: $3.50/d for first 40 days (far-off), $6.00/d for last 20 days (close-up)
  dryPeriodFarOffDays: 40,
  dryPeriodFarOffFeedCost: 3.50,
  dryPeriodCloseUpDays: 20,
  dryPeriodCloseUpFeedCost: 6.00,

  // ── Calf values (Angus slider-driven; Holstein = Angus × holsteinCalfRatio) ──
  // Angus-sired calves from dairy dams command a premium for feedlot finishing.
  // Holstein bull calves have much lower meat value per pound due to lighter muscling.
  // Current market: Holsteins typically 55-65% of Angus cross value.
  calfValueAngus: 1680,           // adjustable via slider
  holsteinCalfRatio: 0.60,        // Holstein = 60% of Angus calf value
  dryPeriodDays: 60,  // total (40 far-off + 20 close-up)
  milkingDaysPerLactation: 340,  // cow; heifer uses 330 via curve sum

  // ── Conception rates by lactation (probability of conceiving per cycle) ──
  // Sources: VT Extension (Nebel): heifers ~65%, lactating cows 40-50% in well-managed herds
  // High-producing herds with TAI programs (UW-Madison Fricke): exceed 50% CCR
  // Average US Holstein CCR: ~35% (BMC Genomics 2019); well-managed high-producing: ~50%
  // Using moderate-optimistic values for a quality commercial herd at 28,000 lbs/cow
  conceptionRateByLact: {
    0:   0.65,  // open heifers / pre-first-calving (VT Extension: ~65%)
    1:   0.50,  // 1st lactation — elevated vs older cows, uterine recovery effect
    2:   0.52,  // 2nd lactation — peak fertility
    3:   0.48,  // 3rd lactation — slight decline
    4:   0.42,  // 4th lactation — declining fertility
    5:   0.36,  // 5th lactation — notable decline
    6:   0.30,  // 6th+ lactation — significant fertility reduction
  },

  // ── Annual survivability by lactation number ──
  // (probability cow remains in herd through that lactation, given she entered it)
  // Sources:
  //   DHIA: avg annual cull rate 38% (range <10% to >60%) — DRMS 2019
  //   PMC longevity review: survival to parity 3 = ~29% of cows; parity 2 survival ~51%
  //   Culling patterns (Hadley et al.): 26% chance 1st lact avg cow culled during/after 1st lact
  //   Risk increases with parity: mastitis 2.5x, lameness 5.6x at parity 5+ vs parity 1
  //   Conception failure is #1 cull reason (40% of cull decisions)
  //   Combined voluntary + involuntary; includes open/late-conceived cows culled for infertility
  // ── Annual survivability by lactation number ──
  // Recalibrated to match Hare et al. (2006), J. Dairy Sci. 89:3713-3720
  //   13.8 million US dairy cows, cumulative survival: 73%→P2, 50%→P3, 32%→P4,
  //   19%→P5, 10%→P6, 5%→P7, 2%→P8
  // Derived conditional per-lactation rates from those cumulative figures.
  // Note: late-lactation rates (L5+) are HIGHER than early because surviving cows
  //   are positively selected — the weakest have already been culled.
  survivalByLact: {
    1:  0.730,  // L1→L2: 73.0% (Hare et al.)
    2:  0.685,  // L2→L3: 68.5% (50/73)
    3:  0.640,  // L3→L4: 64.0% (32/50)
    4:  0.594,  // L4→L5: 59.4% (19/32)
    5:  0.526,  // L5→L6: 52.6% (10/19) — survivor selection effect begins
    6:  0.500,  // L6→L7: 50.0% (5/10)
    7:  0.400,  // L7→L8: 40.0% (2/5)
  },

  // ── Days open adjustment ──
  daysOpenPerFailedService: 21,
  maxServicesBeforeCull: 3,

  // ── Heifer completion rates by stage (probability of surviving each phase) ──
  // Source: Dr. Michael Overton/Zoetis, 85 commercial Holstein herds:
  //   Overall 79% of live-born heifer calves reach the milking string (21% never make it)
  // Breakdown by stage:
  //   Preweaned (birth→weaning ~65 days): 5.0% mortality (USDA NAHMS 2014)
  //     => 95% survival
  //   Weaned heifer (weaning→breeding ~14 months): 1.8% mortality (USDA NAHMS 2007)
  //     + ~4% culled for growth/health issues => ~94% survival
  //   Bred heifer (breeding→first calving ~9 months): failed conception + late culls
  //     => ~88% survival (accounts for repeat breeders, injuries, open heifers culled)
  //     Heifer CCR ~65% first service; ~88% conceive within breeding window
  //   Combined: 0.95 × 0.94 × 0.88 ≈ 0.786 — matches Overton's ~79% field data
  heiferCompletionByStage: {
    preweaned_lot1: 0.82,  // Lot 1 Hutch Calves — user specified 82%
    preweaned_lot2: 0.85,  // Lot 2 Running Corrals 75-120 days — user specified 85%
    preweaned:    0.95,    // Lot 3 Running Corrals 121-150 days — standard
    openHeifer:   0.94,    // weaned open heifers not yet bred (lots 4–13)
    aiHeifer:     0.91,    // confirmed AI but early pregnancy (lots 14–15)
    bredHeifer:   0.93,    // confirmed pregnant heifers (lots 16–23)
    springer:     0.98,    // close-up springers (lot 24)
  },

  // ── 50% Angus breeding on all lots ──
  angusBreedingPct: 0.50,

  // ── Heifer salvage values (for animals that DIE or are CULLED before reaching milking) ──
  // Weight-scaled by stage; reflects that a dead preweaned calf has no salvage value,
  // while a bred heifer culled at 1,300 lbs is nearly as valuable as a cull cow.
  // User-specified values:
  heiferSalvageByStage: {
    preweaned:     { dollars: 0 },                     // Lot 1 hutch — dead calf, no salvage
    runningCorral: { weightLbs: 500,  pricePerLb: 1.50 }, // Lots 2-3 running corrals (~$750)
    openHeifer:    { weightLbs: 800,  pricePerLb: 1.50 }, // Lots 4-13 open heifers (~$1,200)
    aiHeifer:      { weightLbs: 1100, pricePerLb: 1.80 }, // Lots 14-15 AI heifers (~$1,980)
    bredHeiferEarly:{ weightLbs: 1150, pricePerLb: 1.80 }, // Lots 16-18 (1-4 mo preg, ~$2,070)
    bredHeiferLate: { weightLbs: 1300, pricePerLb: 1.80 }, // Lots 19-23 (5-9 mo preg, ~$2,340)
    springer:      { weightLbs: 1400, pricePerLb: 1.80 }, // Lot 24 springers (~$2,520)
  },

  // ── Fresh cow death risk by lactation (first 60 DIM, zero salvage) ──
  // Source: Field data + parity-scaled disease risk (mastitis 2.5x, lameness 5.6x, RP 2.3x
  //   at parity 5+ vs parity 1; "died" is #1 disposal code in early lactation).
  // Scales with parity as metabolic stress and cumulative disease burden increase.
  freshDeathRiskByLact: {
    1:  0.03,   // 1st lactation fresh: 3%
    2:  0.05,   // 2nd lactation fresh: 5%
    3:  0.07,   // 3rd lactation fresh: 7%
    4:  0.09,   // 4th lactation fresh: 9%
    5:  0.12,   // 5th+ lactation fresh: 12%
    6:  0.12,
    7:  0.12,
  },

  // ── Transition/transport stress for purchased cows near calving ──
  // Moving a cow in late gestation disrupts rumen adaptation, social hierarchy,
  // environmental pathogen exposure, and calcium metabolism during the critical
  // 21-day pre-fresh window. Additional death risk ON TOP of base fresh death risk,
  // applied only to the FIRST freshening after purchase.
  // Tiered by proximity to calving (more pregnant = less time to acclimate = higher risk):
  //   Close-ups (2-3 wk pre-fresh): worst — in the danger zone during ration transition
  //   Springers (~14 days): moderate — usually already on close-up ration pre-sale
  //   Early-dry cows (4-6 mo preg): mild — have 6+ weeks to acclimate before calving
  transportStressPenalty: {
    springer:     0.02,   // Lot 24 springers: +2%
    closeup:      0.05,   // Lots 84, 88 close-ups: +5% (worst)
    earlyDry:     0.01,   // Lots 80, 81, 83, 85, 86, 89 dry cows: +1%
    bredHeifer:   0.00,   // Lots 16-23 bred heifers: no penalty (far enough out to adapt)
    aiHeifer:     0.00,
    openHeifer:   0.00,
    calves:       0.00,
    milking:      0.00,   // already milking = transition already completed
  },

  // ── 3T (3-teated) cow production penalty ──
  // Cows with one blind/lost quarter produce less milk. Remaining three quarters
  // partially compensate, so the hit is typically less than a full 25% quarter loss.
  // Applied as IOFC reduction on lots flagged threeT: true (Lots 77, 89).
  threeTeatPenalty: 0.20,  // 20% IOFC reduction for 3T cows (lasts entire remaining life)

  // ── Baseline annual death risk (all milking/dry cows) ──
  // Covers random mortality: hardware disease, bloat, injury, sudden illness.
  // Applied every year as a cumSurvProb multiplier. Zero salvage (unexpected death).
  baselineAnnualDeathRisk: 0.01,  // 1% per year on all milking animals

  // ── Calf DOA / stillbirth rate ──
  // USDA NAHMS: ~5% of Holstein calvings result in stillbirth or neonatal death <48hr.
  // Applied as a reduction to calf revenue on every calving event.
  calfDOARate: 0.05,  // 5% of calves are DOA — zero salvage

  // ── Buyer profile ──
  // Different buyer operations evaluate lots differently:
  //   STRICT: user's herd — DIM 275 hard cutoff, tight breeding management, premium prices paid
  //     for confirmed-pregnant animals, late-DIM opens treated as near-certain culls.
  //   PERMISSIVE: extended-breeding buyer — DIM 400 cutoff, continues breeding through DIM 350+,
  //     accepts ~45% eventual conception on late-DIM opens, longer calving intervals.
  //     This is how a less-intensive operation would value late-DIM problem lots like Lot 75.
  buyerProfile: "strict",  // "strict" | "permissive"
  profiles: {
    strict: {
      label: "Strict (Your Herd)",
      dimHardCutoff: 275,
      dimPenaltyStart: 100,
      dimPenaltySlope: 0.23,  // pts/day past start
      dimPenaltyMax: 40,      // max pts at cutoff
      lateDimEventualCCR: null,  // N/A — strict buyer culls before this matters
      description: "DIM 275 hard breeding cutoff, progressive penalty from DIM 100",
    },
    permissive: {
      label: "Permissive (Extended-Breeding Buyer)",
      dimHardCutoff: 400,
      dimPenaltyStart: 200,
      dimPenaltySlope: 0.15,
      dimPenaltyMax: 30,
      lateDimEventualCCR: 0.45,  // 45% of late-DIM opens eventually conceive
      description: "DIM 400 cutoff, softer penalty, 45% eventual conception on late-DIM opens",
    },
  },
};

// ─── LOT DATA ───
const LOTS = [
  { lot: 1,  desc: "Holstein Hutch Calves",                        hd: 186, bid: 1330,  category: "calves",      lactation: 0,  stage: "hutch",         dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 2,  desc: "Running Corrals, 75-120 Days",                 hd: 152, bid: 1580,  category: "calves",      lactation: 0,  stage: "running",       dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 3,  desc: "Running Corrals, 121-150 Days",                hd: 73,  bid: 1775,  category: "calves",      lactation: 0,  stage: "running",       dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 4,  desc: "Holstein Heifers (A&M)",                       hd: 33,  bid: 1800,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 5,  desc: "Holstein Heifers (A&M)",                       hd: 40,  bid: 2060,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 6,  desc: "Holstein Heifers (A&M)",                       hd: 57,  bid: 2080,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 7,  desc: "Holstein Open Heifers (A&M)",                  hd: 61,  bid: 2200,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 8,  desc: "Holstein Open Heifers (A&M)",                  hd: 44,  bid: 2360,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 9,  desc: "Holstein Open Heifers (A&M)",                  hd: 70,  bid: 2660,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 10, desc: "Holstein Open Heifers (A&M)",                  hd: 102, bid: 2950,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 11, desc: "Holstein Open Heifers (A&M)",                  hd: 117, bid: 3100,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 12, desc: "Holstein Open Heifers (A&M)",                  hd: 27,  bid: 3075,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 13, desc: "Holstein Open Heifers (A&M)",                  hd: 82,  bid: 3150,  category: "heifers",     lactation: 0,  stage: "open_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 0,  dryoff: false },
  { lot: 14, desc: "Holstein Heifers, AI (A&M)",                   hd: 35,  bid: 3025,  category: "heifers",     lactation: 0,  stage: "ai_heifer",     dimFrom: 0,   dimTo: 0,   pregMonth: 1,  dryoff: false },
  { lot: 15, desc: "Holstein Heifers, AI (A&M)",                   hd: 45,  bid: 3250,  category: "heifers",     lactation: 0,  stage: "ai_heifer",     dimFrom: 0,   dimTo: 0,   pregMonth: 1,  dryoff: false },
  { lot: 16, desc: "1-2 Month Bred Heifers",                       hd: 62,  bid: 3550,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 1.5,dryoff: false },
  { lot: 17, desc: "3 Month Bred Heifers",                         hd: 25,  bid: 3675,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 3,  dryoff: false },
  { lot: 18, desc: "4 Month Bred Heifers",                         hd: 30,  bid: 3700,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 4,  dryoff: false },
  { lot: 19, desc: "5 Month Bred Heifers",                         hd: 23,  bid: 3825,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 5,  dryoff: false },
  { lot: 20, desc: "6 Month Bred Heifers",                         hd: 51,  bid: 3875,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 6,  dryoff: false },
  { lot: 21, desc: "7 Month Bred Heifers",                         hd: 48,  bid: 3975,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: false },
  { lot: 22, desc: "8 Month Bred Heifers",                         hd: 48,  bid: 4075,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 8,  dryoff: false },
  { lot: 23, desc: "9 Month Bred Heifers",                         hd: 11,  bid: 4150,  category: "bred_heifers",lactation: 0,  stage: "bred_heifer",   dimFrom: 0,   dimTo: 0,   pregMonth: 9,  dryoff: false },
  { lot: 24, desc: "Springers (Blue S)",                           hd: 38,  bid: 4150,  category: "bred_heifers",lactation: 0,  stage: "springer",      dimFrom: 0,   dimTo: 0,   pregMonth: 9,  dryoff: false },
  { lot: 25, desc: "1st & 2nd Lact, 1-15 DIM Fresh",              hd: 25,  bid: 3675,  category: "milking",     lactation: 1.5,stage: "fresh",         dimFrom: 1,   dimTo: 15,  pregMonth: 0,  dryoff: false },
  { lot: 26, desc: "1st Lact, 16-65 DIM, Open",                   hd: 35,  bid: 3625,  category: "milking",     lactation: 1,  stage: "early",         dimFrom: 16,  dimTo: 65,  pregMonth: 0,  dryoff: false },
  { lot: 27, desc: "1st Lact, 16-65 DIM, Open",                   hd: 35,  bid: 3525,  category: "milking",     lactation: 1,  stage: "early",         dimFrom: 16,  dimTo: 65,  pregMonth: 0,  dryoff: false },
  { lot: 30, desc: "1st Lact, 66-120 DIM, Open/Service",          hd: 35,  bid: 3400,  category: "milking",     lactation: 1,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 31, desc: "1st Lact, 66-120 DIM, Open/Service",          hd: 35,  bid: 3375,  category: "milking",     lactation: 1,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 34, desc: "1st Lact, 121-200 DIM, Open/Service",         hd: 35,  bid: 3025,  category: "milking",     lactation: 1,  stage: "late",          dimFrom: 121, dimTo: 200, pregMonth: 0,  dryoff: false },
  { lot: 35, desc: "1st Lact, 121-200 DIM, Open/Service",         hd: 19,  bid: 2925,  category: "milking",     lactation: 1,  stage: "late",          dimFrom: 121, dimTo: 200, pregMonth: 0,  dryoff: false },
  { lot: 36, desc: "1st Lact, 1-2 Months Pregnant",               hd: 35,  bid: 3150,  category: "milking",     lactation: 1,  stage: "mid",           dimFrom: 100, dimTo: 150, pregMonth: 1.5,dryoff: false },
  { lot: 38, desc: "1st Lact, 3-4 Months Pregnant",               hd: 35,  bid: 2900,  category: "milking",     lactation: 1,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 41, desc: "1st Lact, 5-6 Months Pregnant",               hd: 35,  bid: 3100,  category: "milking",     lactation: 1,  stage: "late_preg",     dimFrom: 200, dimTo: 250, pregMonth: 5.5,dryoff: false },
  { lot: 43, desc: "1st Lact, 1-6 Mo Pregnant (Bred Angus)",      hd: 35,  bid: 3425,  category: "milking",     lactation: 1,  stage: "mid",           dimFrom: 100, dimTo: 200, pregMonth: 3,  dryoff: false, angus: true },
  { lot: 45, desc: "2nd Lact, 16-65 DIM, Open",                   hd: 34,  bid: 3450,  category: "milking",     lactation: 2,  stage: "early",         dimFrom: 16,  dimTo: 65,  pregMonth: 0,  dryoff: false },
  { lot: 47, desc: "2nd Lact, 66-120 DIM, Open/Service",          hd: 34,  bid: 3300,  category: "milking",     lactation: 2,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 48, desc: "2nd Lact, 66-120 DIM, Open/Service",          hd: 34,  bid: 3250,  category: "milking",     lactation: 2,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 50, desc: "2nd Lact, 121-200 DIM, Open/Service",         hd: 32,  bid: 3025,  category: "milking",     lactation: 2,  stage: "late",          dimFrom: 121, dimTo: 200, pregMonth: 0,  dryoff: false },
  { lot: 51, desc: "2nd Lact, 1-2 Months Pregnant",               hd: 32,  bid: 3025,  category: "milking",     lactation: 2,  stage: "mid",           dimFrom: 100, dimTo: 150, pregMonth: 1.5,dryoff: false },
  { lot: 52, desc: "2nd Lact, 3-4 Months Pregnant",               hd: 34,  bid: 3000,  category: "milking",     lactation: 2,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 53, desc: "2nd Lact, 3-4 Months Pregnant",               hd: 28,  bid: 2950,  category: "milking",     lactation: 2,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 54, desc: "2nd Lact, 5-6 Months Pregnant",               hd: 34,  bid: 2900,  category: "milking",     lactation: 2,  stage: "late_preg",     dimFrom: 200, dimTo: 250, pregMonth: 5.5,dryoff: false },
  { lot: 55, desc: "2nd Lact, 5-6 Months Pregnant",               hd: 9,   bid: 2875,  category: "milking",     lactation: 2,  stage: "late_preg",     dimFrom: 200, dimTo: 250, pregMonth: 5.5,dryoff: false },
  { lot: 56, desc: "2nd Lact, 1-6 Mo Pregnant (Bred Angus)",      hd: 24,  bid: 3525,  category: "milking",     lactation: 2,  stage: "mid",           dimFrom: 100, dimTo: 200, pregMonth: 3,  dryoff: false, angus: true },
  { lot: 57, desc: "3rd & 4th+ Lact, 1-16 DIM Fresh",             hd: 11,  bid: 2800,  category: "milking",     lactation: 3.5,stage: "fresh",         dimFrom: 1,   dimTo: 16,  pregMonth: 0,  dryoff: false },
  { lot: 58, desc: "3rd Lact, 16-65 DIM, Open",                   hd: 31,  bid: 2900,  category: "milking",     lactation: 3,  stage: "early",         dimFrom: 16,  dimTo: 65,  pregMonth: 0,  dryoff: false },
  { lot: 59, desc: "3rd Lact, 66-120 DIM, Open/Service",          hd: 32,  bid: 2750,  category: "milking",     lactation: 3,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 60, desc: "3rd Lact, 66-120 DIM, Open/Service",          hd: 27,  bid: 2625,  category: "milking",     lactation: 3,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 61, desc: "3rd Lact, 121-200 DIM, Open/Carrying Svc",    hd: 37,  bid: 2525,  category: "milking",     lactation: 3,  stage: "late",          dimFrom: 121, dimTo: 200, pregMonth: 0,  dryoff: false },
  { lot: 62, desc: "3rd Lact, 1-2 Months Pregnant",               hd: 18,  bid: 2425,  category: "milking",     lactation: 3,  stage: "mid",           dimFrom: 100, dimTo: 150, pregMonth: 1.5,dryoff: false },
  { lot: 63, desc: "3rd Lact, 3-4 Months Pregnant",               hd: 32,  bid: 2450,  category: "milking",     lactation: 3,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 64, desc: "3rd Lact, 3-4 Months Pregnant",               hd: 22,  bid: 2300,  category: "milking",     lactation: 3,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 65, desc: "3rd Lact, 5-6 Months Pregnant",               hd: 35,  bid: 2425,  category: "milking",     lactation: 3,  stage: "late_preg",     dimFrom: 200, dimTo: 250, pregMonth: 5.5,dryoff: false },
  { lot: 66, desc: "3rd & 4th+ Lact, 1-6 Mo Preg (Bred Angus)",  hd: 26,  bid: 2900,  category: "milking",     lactation: 3.5,stage: "mid",           dimFrom: 100, dimTo: 200, pregMonth: 3,  dryoff: false, angus: true },
  { lot: 67, desc: "4th Lact, 16-65 DIM, Open",                   hd: 32,  bid: 2350,  category: "milking",     lactation: 4,  stage: "early",         dimFrom: 16,  dimTo: 65,  pregMonth: 0,  dryoff: false },
  { lot: 68, desc: "4th Lact, 66-120 DIM, Open/Carrying Svc",     hd: 30,  bid: 2250,  category: "milking",     lactation: 4,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 69, desc: "4th Lact, 66-120 DIM, Open/Carrying Svc",     hd: 29,  bid: 2225,  category: "milking",     lactation: 4,  stage: "mid",           dimFrom: 66,  dimTo: 120, pregMonth: 0,  dryoff: false },
  { lot: 70, desc: "4th Lact, 121-200 DIM, Open/Carrying Svc",    hd: 30,  bid: 2025,  category: "milking",     lactation: 4,  stage: "late",          dimFrom: 121, dimTo: 200, pregMonth: 0,  dryoff: false },
  { lot: 71, desc: "4th Lact, 1-2 Months Pregnant",               hd: 34,  bid: 2050,  category: "milking",     lactation: 4,  stage: "mid",           dimFrom: 100, dimTo: 150, pregMonth: 1.5,dryoff: false },
  { lot: 72, desc: "4th Lact, 3-4 Months Pregnant",               hd: 30,  bid: 1975,  category: "milking",     lactation: 4,  stage: "mid_late",      dimFrom: 150, dimTo: 200, pregMonth: 3.5,dryoff: false },
  { lot: 74, desc: "4th Lact, 5-6 Months Pregnant",               hd: 13,  bid: 2200,  category: "milking",     lactation: 4,  stage: "late_preg",     dimFrom: 200, dimTo: 250, pregMonth: 5.5,dryoff: false },
  { lot: 75, desc: "1st-3rd Lact, 201-350 DIM, Open/Carrying Svc",hd: 34,  bid: 1900,  category: "milking",     lactation: 2,  stage: "far_late",      dimFrom: 201, dimTo: 350, pregMonth: 0,  dryoff: false },
  { lot: 77, desc: "1st-3rd Lact, 3T, Open & Pregnant",           hd: 36,  bid: 1700,  category: "milking",     lactation: 3,  stage: "3T",            dimFrom: 150, dimTo: 300, pregMonth: 0,  dryoff: false, threeT: true },
  { lot: 80, desc: "1st→2nd Lact Dry Cows",                       hd: 35,  bid: 3850,  category: "dry",         lactation: 1,  stage: "dry",           dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true },
  { lot: 81, desc: "1st→2nd Lact Dry Cows",                       hd: 35,  bid: 3850,  category: "dry",         lactation: 1,  stage: "dry",           dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true },
  { lot: 83, desc: "1st→2nd Lact Dry Cows (Bred Angus)",          hd: 17,  bid: 4250,  category: "dry",         lactation: 1,  stage: "dry",           dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true, angus: true },
  { lot: 84, desc: "1st & 2nd Lact Close-ups",                    hd: 29,  bid: 3650,  category: "dry",         lactation: 1.5,stage: "closeup",       dimFrom: 0,   dimTo: 0,   pregMonth: 9,  dryoff: true },
  { lot: 85, desc: "2nd→3rd Lact Dry Cows",                       hd: 24,  bid: 3700,  category: "dry",         lactation: 2,  stage: "dry",           dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true },
  { lot: 86, desc: "3rd→4th+ Lact Dry Cows",                      hd: 21,  bid: 3025,  category: "dry",         lactation: 3,  stage: "dry",           dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true },
  { lot: 88, desc: "3rd & 4th+ Lact Close-ups",                   hd: 8,   bid: 3000,  category: "dry",         lactation: 3.5,stage: "closeup",       dimFrom: 0,   dimTo: 0,   pregMonth: 9,  dryoff: true },
  { lot: 89, desc: "1st-3rd Lact, 3T, Dry Cows",                  hd: 10,  bid: 2975,  category: "dry",         lactation: 3,  stage: "3T_dry",        dimFrom: 0,   dimTo: 0,   pregMonth: 7,  dryoff: true, threeT: true },
];

// ─── NPV ENGINE (probability-weighted: conception rate + survivability + heifer completion) ───
//
// Three layers of probability discount:
//  1. Heifer completion rate: P(calf/heifer reaches milking string) by stage
//     Source: Overton/Zoetis 85-herd study — 79% overall; broken down by phase:
//       preweaned 95%, open heifer 94%, AI heifer 91%, bred heifer 93%, springer 98%
//  2. Conception rate by lactation: adjusts expected days open via geometric series
//     Source: VT Extension (Nebel), UW-Madison (Fricke), BMC Genomics 2019
//  3. Annual survivability by lactation: probability cow remains in herd each year
//     Source: DHIA/DRMS 2019, Frontiers Genetics 2021, ScienceDirect longevity review
//
// Raising costs for pre-fresh animals are treated as certain (paid regardless of outcome).
// All revenue cash flows are probability-weighted by cumSurvProb = completionProb × lactSurvival.
//
function computeNPV(lot, assumptions) {
  const {
    discountRate, projectionYears,
    cullValuePerLb, cullCowWeightLbs,
    heiferRaisingCostPerDay,
    milkPricePerCwt, lactationCurve,
    dryPeriodFarOffDays, dryPeriodFarOffFeedCost,
    dryPeriodCloseUpDays, dryPeriodCloseUpFeedCost,
    calfValueAngus, holsteinCalfRatio,
    dryPeriodDays,
    conceptionRateByLact, survivalByLact,
    daysOpenPerFailedService,
    heiferCompletionByStage,
  } = assumptions;

  // ── Stage-based IOFC lookup ──
  // Given (lactation number, DIM), return IOFC ($/day) from the herd curve.
  // Heifers (lact=1) use the heifer curve; cows (lact 2+) use the cow curve.
  // DIM past end-of-curve: returns the last stage's IOFC (far-late).
  function iofcAtDim(lact, dim) {
    const curve = lact <= 1 ? lactationCurve.heifer : lactationCurve.cow;
    let cumDays = 0;
    for (const stage of curve) {
      if (dim < cumDays + stage.days) {
        // 3T cows: 20% IOFC reduction (applies for life)
        const milkRev = stage.milkLbs * milkPricePerCwt / 100;
        let iofc = milkRev - stage.feedCost;
        if (lot.threeT) iofc = milkRev * (1 - assumptions.threeTeatPenalty) - stage.feedCost;
        return iofc;
      }
      cumDays += stage.days;
    }
    // past end of curve → treat as far-late
    const last = curve[curve.length - 1];
    const milkRev = last.milkLbs * milkPricePerCwt / 100;
    let iofc = milkRev - last.feedCost;
    if (lot.threeT) iofc = milkRev * (1 - assumptions.threeTeatPenalty) - last.feedCost;
    return iofc;
  }

  // Full-lactation length for this lactation (340 for cows, 330 for heifers)
  function fullLactationDays(lact) {
    const curve = lact <= 1 ? lactationCurve.heifer : lactationCurve.cow;
    return curve.reduce((sum, s) => sum + s.days, 0);
  }

  // Dry period cost at a given day within the dry period (0..dryPeriodDays)
  function dryFeedCostAtDay(dayInDry) {
    return dayInDry < dryPeriodFarOffDays ? dryPeriodFarOffFeedCost : dryPeriodCloseUpFeedCost;
  }

  const calfValueHolstein = calfValueAngus * holsteinCalfRatio;
  const calfValueBase = lot.angus
    ? calfValueAngus
    : (calfValueAngus * assumptions.angusBreedingPct + calfValueHolstein * (1 - assumptions.angusBreedingPct));
  const calfValue = calfValueBase;
  const cullValue = cullValuePerLb * cullCowWeightLbs;
  const totalDays = projectionYears * 365;

  // ── Heifer salvage value if this animal fails to reach milking ──
  function getHeiferSalvageValue() {
    const hs = assumptions.heiferSalvageByStage;
    const { category: cat, stage, lot: lotNum } = lot;
    if (cat === "milking" || cat === "dry") return cullValue; // cows use full cull value
    if (stage === "springer") return hs.springer.weightLbs * hs.springer.pricePerLb;
    if (cat === "bred_heifers") {
      const pm = lot.pregMonth || 0;
      if (pm <= 4) return hs.bredHeiferEarly.weightLbs * hs.bredHeiferEarly.pricePerLb;
      return hs.bredHeiferLate.weightLbs * hs.bredHeiferLate.pricePerLb;
    }
    if (stage === "ai_heifer") return hs.aiHeifer.weightLbs * hs.aiHeifer.pricePerLb;
    if (cat === "heifers") return hs.openHeifer.weightLbs * hs.openHeifer.pricePerLb;
    if (cat === "calves") {
      if (lotNum === 1) return hs.preweaned.dollars || 0; // hutch calves: $0
      return hs.runningCorral.weightLbs * hs.runningCorral.pricePerLb; // running corrals
    }
    return 0;
  }
  const heiferSalvageValue = getHeiferSalvageValue();

  // ── Layer 1: Heifer completion probability (lot-specific for Lots 1 & 2) ──
  function getCompletionProb() {
    const { category: cat, stage, lot: lotNum } = lot;
    if (cat === "milking" || cat === "dry") return 1.0;
    if (stage === "springer") return heiferCompletionByStage.springer;
    if (cat === "bred_heifers") return heiferCompletionByStage.bredHeifer;
    if (stage === "ai_heifer") return heiferCompletionByStage.aiHeifer;
    if (cat === "heifers") return heiferCompletionByStage.openHeifer;
    if (cat === "calves") {
      if (lotNum === 1) return heiferCompletionByStage.preweaned_lot1;
      if (lotNum === 2) return heiferCompletionByStage.preweaned_lot2;
      return heiferCompletionByStage.preweaned;
    }
    return 1.0;
  }
  const completionProb = getCompletionProb();

  // ── Layer 2: Expected extra days open per lactation from conception failures ──
  function expectedExtraDaysOpen(lact) {
    const ccr = conceptionRateByLact[Math.min(Math.floor(lact), 6)] || 0.30;
    return Math.max(0, (1 / ccr - 1)) * daysOpenPerFailedService;
  }

  // ── Layer 3: Annual survivability per lactation ──
  // Base survivability by lactation, adjusted for:
  //   Current lactation ONLY:
  //     + Pregnancy boost: confirmed pregnant = skip infertility cull risk this lact
  //     - DIM penalty: past VWP & approaching breeding cutoff = elevated cull risk
  //       → DIM 275+ = hard cutoff (user's herd: no breeding past DIM 275)
  //         Open cows past DIM 275 are treated as near-certain culls (survProb floor ~5%)
  //   All lactations (persistent):
  //     + Fertility boost: cows currently Lact 2+ have demonstrated repeat-breeder reliability
  //       → +2 pts to all future survival transitions
  function survProb(lact, isFirstLactation) {
    // BUG FIX: use Math.floor() so fractional lactation values (1.5, 3.5) hit the correct
    // integer key in survivalByLact. e.g. lact=3.5 → key 3, not undefined.
    const lactKey = Math.min(Math.floor(lact), 7);
    let base = survivalByLact[lactKey] || 0.30;

    // Persistent fertility boost: applies to ALL lactations for cows entering at Lact 2+
    const startLactNormalized = Math.ceil(lot.lactation || 0);
    if (startLactNormalized >= 2) {
      base = Math.min(0.98, base + 0.02);
    }

    if (!isFirstLactation) return base;

    // Current lactation — pregnancy boost
    if (lot.pregMonth && lot.pregMonth > 0) {
      const boostPts = Math.min(15, lot.pregMonth * 2.5) / 100;
      return Math.min(0.98, base + boostPts);
    }

    // Current lactation — DIM penalty for open milking cows (profile-dependent)
    if (lot.category === "milking" && (!lot.pregMonth || lot.pregMonth === 0)) {
      const midDim = (lot.dimFrom + lot.dimTo) / 2 || lot.dimFrom || 0;
      const profile = assumptions.profiles[assumptions.buyerProfile];

      if (midDim >= profile.dimHardCutoff) {
        // Permissive buyer: even past their cutoff, some of these cows still delivered
        // under the extended breeding window. Use eventualCCR as a floor.
        // Strict buyer: hard 5% floor (near-certain cull).
        if (profile.lateDimEventualCCR) {
          return Math.max(0.10, profile.lateDimEventualCCR * 0.6);
        }
        return 0.05;
      }

      const penaltyPts = Math.min(
        profile.dimPenaltyMax,
        Math.max(0, (midDim - profile.dimPenaltyStart) * profile.dimPenaltySlope)
      ) / 100;

      let adjusted = Math.max(0.05, base - penaltyPts);

      // Permissive buyer: boost survival for late-DIM cows reflecting extended breeding
      // success. At DIM 275+ open, a permissive buyer achieves ~45% eventual conception,
      // which pulls survival closer to that CCR than the raw strict-mode penalty would suggest.
      if (profile.lateDimEventualCCR && midDim >= 200) {
        // Blend: the deeper into late DIM, the more the eventualCCR floor matters
        const blendWeight = Math.min(1, (midDim - 200) / (profile.dimHardCutoff - 200));
        const ccrFloor = profile.lateDimEventualCCR;
        adjusted = adjusted * (1 - blendWeight) + ccrFloor * blendWeight;
      }

      return adjusted;
    }

    return base;
  }

  function daysUntilFresh() {
    const { category: cat, stage } = lot;
    if (cat === "milking") return 0;
    if (cat === "dry") return stage === "closeup" ? 14 : (9 - lot.pregMonth) * 30.5;
    if (stage === "springer") return 14;
    if (cat === "bred_heifers") return (9 - lot.pregMonth) * 30.5;
    if (stage === "ai_heifer") return 7 * 30.5;
    if (cat === "calves") return 24 * 30.5;
    if (lot.bid >= 3000) return 10 * 30.5;
    if (lot.bid >= 2500) return 13 * 30.5;
    if (lot.bid >= 2000) return 16 * 30.5;
    return 20 * 30.5;
  }

  const freshDay = lot.category === "milking" ? 0 : Math.round(daysUntilFresh());
  const dimOffset = lot.category === "milking" ? ((lot.dimFrom + lot.dimTo) / 2 || lot.dimFrom || 15) : 0;

  const annualCF = new Array(projectionYears).fill(0);
  const getYear = d => Math.min(projectionYears - 1, Math.floor(d / 365));

  // ── Transport/transition stress penalty (first freshening only) ──
  // Applied only to the FIRST fresh event after purchase
  function getTransportStressPenalty() {
    const ts = assumptions.transportStressPenalty;
    const { category: cat, stage } = lot;
    if (cat === "milking") return 0; // already through transition
    if (stage === "springer") return ts.springer;
    if (cat === "dry") {
      if (stage === "closeup") return ts.closeup;
      return ts.earlyDry;
    }
    if (cat === "bred_heifers") return ts.bredHeifer;
    if (stage === "ai_heifer") return ts.aiHeifer;
    if (cat === "heifers") return ts.openHeifer;
    if (cat === "calves") return ts.calves;
    return 0;
  }
  const transportStressExtra = getTransportStressPenalty();

  let day = 0;
  let currentLact = Math.max(lot.lactation, 0);
  let cumSurvProb = completionProb;
  let lactCount = 0;

  // Capture detailed trace for UI display
  const lactationDetails = [];
  const annualDetail = Array.from({length: projectionYears}, () => ({
    raising: 0, milk: 0, xOpen: 0, dry: 0, calf: 0, exitCull: 0, termCull: 0,
    nonCompletionSalvage: 0, milkDays: 0, xDays: 0, dryDays: 0,
    lactStr: '—', survStr: '—', freshDeath: 0,
  }));

  // Pre-fresh raising costs are certain
  for (let d = 0; d < freshDay && d < totalDays; d++) {
    annualCF[getYear(d)] -= heiferRaisingCostPerDay;
    annualDetail[getYear(d)].raising -= heiferRaisingCostPerDay;
  }

  // Non-completion salvage credit
  let nonCompletionSalvageTotal = 0;
  if (completionProb < 1.0 && freshDay < totalDays) {
    const nonCompletionProb = 1 - completionProb;
    nonCompletionSalvageTotal = nonCompletionProb * heiferSalvageValue;
    annualCF[getYear(freshDay)] += nonCompletionSalvageTotal;
    annualDetail[getYear(freshDay)].nonCompletionSalvage += nonCompletionSalvageTotal;
  }

  day = freshDay;
  // ── Correct lactation initialization by category ──
  // BUG FIX: previous code reset ALL non-milking categories to lact 1,
  //   causing dry cows (e.g. 3rd→4th) to be modeled as first-lactation animals.
  // Calves & heifers:     → Lact 1 (first freshening)
  // Dry cows:             → Math.ceil(lot.lactation) + 1 (next lactation after drying off)
  //   e.g. Lot 80 (lact=1, 1st→2nd dry): freshens into Lact 2
  //   e.g. Lot 86 (lact=3, 3rd→4th dry): freshens into Lact 4
  //   e.g. Lot 88 (lact=3.5, 3rd/4th+ close-up): freshens into Lact 5
  // Milking cows already at fractional lact (1.5, 3.5): use Math.ceil() for table lookups
  if (lot.category === "calves" || lot.category === "heifers" || lot.category === "bred_heifers") {
    currentLact = 1;
  } else if (lot.category === "dry") {
    currentLact = Math.ceil(lot.lactation) + 1;
  } else {
    // milking: already set to lot.lactation above — leave as-is for DIM tracking
    // but normalize fractional values for table lookups (handled in survProb/freshDeathRisk)
  }

  while (day < totalDays && cumSurvProb > 0.005) {
    const lact = currentLact;
    const lactStartDay = day;  // capture start of this lactation for gestation timing calc
    const startDim = (day === 0 && lot.category === "milking") ? dimOffset : 0;
    const totalLactDays = fullLactationDays(lact);  // 340 for cows, 330 for heifers
    const baseMilkDays = Math.max(0, totalLactDays - startDim);
    const extraOpenDays = expectedExtraDaysOpen(lact);
    const ccrForLact = conceptionRateByLact[Math.min(Math.floor(lact), 6)] || 0.30;

    // ── Baseline annual death risk ──
    if (lot.category === "milking" || lot.category === "dry") {
      cumSurvProb *= (1 - assumptions.baselineAnnualDeathRisk);
    }

    const isEnteringFresh = !(lactCount === 0 && lot.category === "milking" && startDim > 0);
    let freshDeathHit = 0;
    let cumSurvBefore = cumSurvProb;
    if (isEnteringFresh) {
      const baseFreshDeath = assumptions.freshDeathRiskByLact[Math.min(Math.floor(lact), 7)] || 0.12;
      const extraStress = lactCount === 0 ? transportStressExtra : 0;
      const totalFreshDeath = baseFreshDeath + extraStress;
      freshDeathHit = totalFreshDeath;
      cumSurvProb *= (1 - totalFreshDeath);
    }

    // Tag the year this lactation starts
    const yrTag = getYear(day);
    if (annualDetail[yrTag].lactStr === '—') {
      annualDetail[yrTag].lactStr = String(lact);
      annualDetail[yrTag].survStr = (cumSurvProb * 100).toFixed(1) + '%';
      annualDetail[yrTag].freshDeath = freshDeathHit;
    }

    let milkRev = 0, xOpenRev = 0, dryRev = 0;
    let milkDaysUsed = 0, xDaysUsed = 0, dryDaysUsed = 0;

    // ── Milking revenue using stage-based IOFC curve ──
    // Each day, look up IOFC at current DIM from the herd curve
    for (let m = 0; m < baseMilkDays && day < totalDays; m++, day++) {
      const currentDim = startDim + m;
      const iofcToday = iofcAtDim(lact, currentDim);
      const amt = iofcToday * cumSurvProb;
      annualCF[getYear(day)] += amt;
      annualDetail[getYear(day)].milk += amt;
      annualDetail[getYear(day)].milkDays++;
      milkRev += amt; milkDaysUsed++;
    }

    // ── Extra open days (after full lactation curve ends, cow continues milking at decline) ──
    // Uses the final stage's IOFC (far-late) as the tail rate, at 60% effective
    // since production declines further past normal lactation length.
    // Capture the "final stage" IOFC as a snapshot for the extra-open period.
    const finalStageDim = totalLactDays - 1;
    const tailIofc = iofcAtDim(lact, finalStageDim) * 0.60;
    for (let m = 0; m < Math.round(extraOpenDays) && day < totalDays; m++, day++) {
      const amt = tailIofc * cumSurvProb;
      annualCF[getYear(day)] += amt;
      annualDetail[getYear(day)].xOpen += amt;
      annualDetail[getYear(day)].xDays++;
      xOpenRev += amt; xDaysUsed++;
    }

    // Compute survProb here so it can be used for calfSurvWeight below
    const sp = survProb(lact, lactCount === 0);

    // ── Calf revenue (Option B: gestation-based timing + survProb weighting) ──
    const isFirstCycleOpen = lactCount === 0 && (!lot.pregMonth || lot.pregMonth === 0);
    const isFirstCyclePregnant = lactCount === 0 && lot.pregMonth > 0;

    let calfDay;
    if (isFirstCycleOpen) {
      const dimAtPurchase = (lot.category === "milking") ? startDim : 0;
      const daysToVWP = Math.max(0, 60 - dimAtPurchase);
      const daysToConception = daysToVWP + (21 / ccrForLact);
      calfDay = Math.min(Math.round(lactStartDay + daysToConception + 280), totalDays - 1);
    } else if (!isFirstCycleOpen && lactCount > 0) {
      const daysToConception = 60 + (21 / ccrForLact);
      calfDay = Math.min(Math.round(lactStartDay + daysToConception + 280), totalDays - 1);
    } else {
      calfDay = day;
    }

    const calfSurvWeight = isFirstCyclePregnant ? 1.0 : sp;
    const liveCalf = calfValue * (1 - assumptions.calfDOARate);
    const calfRev = (calfDay < totalDays) ? liveCalf * cumSurvProb * calfSurvWeight : 0;
    if (calfRev > 0) {
      annualCF[getYear(calfDay)] += calfRev;
      annualDetail[getYear(calfDay)].calf += calfRev;
    }

    // ── Two-stage dry period feed cost ──
    // Far-off: first 40 days at $3.50/day (or user-specified)
    // Close-up: last 20 days at $6.00/day (higher-cost close-up ration)
    for (let d2 = 0; d2 < dryPeriodDays && day < totalDays; d2++, day++) {
      const amt = dryFeedCostAtDay(d2) * cumSurvProb;
      annualCF[getYear(day)] -= amt;
      annualDetail[getYear(day)].dry -= amt;
      annualDetail[getYear(day)].dryDays++;
      dryRev -= amt; dryDaysUsed++;
    }

    const exitProb = cumSurvProb * (1 - sp);
    const exitCullRev = (day < totalDays) ? exitProb * cullValue : 0;
    if (day < totalDays) {
      annualCF[getYear(day)] += exitCullRev;
      annualDetail[getYear(day)].exitCull += exitCullRev;
    }

    // Average IOFC for this lactation (for display purposes)
    const avgIofcDisplay = milkDaysUsed > 0 ? milkRev / milkDaysUsed / cumSurvProb : 0;

    lactationDetails.push({
      lact, cumSurvBefore, cumSurvAfterFreshDeath: cumSurvProb, freshDeathHit,
      iofc: avgIofcDisplay, baseMilkDays, extraOpenDays: Math.round(extraOpenDays),
      milkRev, xOpenRev, calfRev, dryRev, exitCullRev,
      milkDaysUsed, xDaysUsed, dryDaysUsed,
      survProb: sp, exitProb,
      ccr: ccrForLact,
      liveCalf, calfSurvWeight, calfDay,
    });

    cumSurvProb *= sp;
    currentLact++;
    lactCount++;
    if (lactCount > 12) break;
  }

  const termCullRev = cumSurvProb * cullValue;
  annualCF[projectionYears - 1] += termCullRev;
  annualDetail[projectionYears - 1].termCull += termCullRev;

  const npv = annualCF.reduce((acc, cf, i) => acc + cf / Math.pow(1 + discountRate, i + 1), 0);
  const totalUndiscounted = annualCF.reduce((a, b) => a + b, 0);

  return {
    npv, cashFlows: annualCF, totalUndiscounted, completionProb,
    // Additional detail for UI
    detail: {
      freshDay, dimOffset, heiferSalvageValue, nonCompletionSalvageTotal,
      transportStressExtra, calfValue, cullValue, raisingDays: freshDay,
      totalRaisingCost: freshDay * heiferRaisingCostPerDay,
      lactationDetails, annualDetail,
    }
  };
}

// ─── UNIQUE LOTS (remove accidental duplicates + attach stable uid for React keys) ───
const UNIQUE_LOTS = LOTS.filter((l, i, arr) =>
  arr.findIndex(x => x.lot === l.lot && x.bid === l.bid && x.hd === l.hd) === i
).map((l, i) => ({ ...l, uid: `${l.lot}-${l.bid}-${l.hd}-${i}` }));

const CATEGORY_LABELS = {
  calves: "Calves",
  heifers: "Open Heifers",
  bred_heifers: "Bred Heifers",
  milking: "Milking Cows",
  dry: "Dry Cows",
};

const CATEGORY_COLORS = {
  calves:       { bg: "#fef3c7", border: "#d97706", text: "#92400e", dot: "#d97706" },
  heifers:      { bg: "#dbeafe", border: "#2563eb", text: "#1d4ed8", dot: "#2563eb" },
  bred_heifers: { bg: "#ede9fe", border: "#7c3aed", text: "#5b21b6", dot: "#7c3aed" },
  milking:      { bg: "#dcfce7", border: "#16a34a", text: "#14532d", dot: "#16a34a" },
  dry:          { bg: "#fce7f3", border: "#db2777", text: "#831843", dot: "#db2777" },
};

function fmt(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }

export default function App() {
  const [sortBy, setSortBy] = useState("npv");
  const [filterCat, setFilterCat] = useState("all");
  const [hoveredLot, setHoveredLot] = useState(null);
  const [selectedLotKey, setSelectedLotKey] = useState(null);
  const [userAssumptions, setUserAssumptions] = useState(ASSUMPTIONS);

  const results = useMemo(() => {
    return UNIQUE_LOTS.map(lot => {
      const { npv, cashFlows, totalUndiscounted, completionProb, detail } = computeNPV(lot, userAssumptions);
      const npvVsBid = npv - lot.bid;
      const roi = ((npv - lot.bid) / lot.bid) * 100;
      return { ...lot, npv, cashFlows, totalUndiscounted, npvVsBid, roi, completionProb, detail };
    });
  }, [userAssumptions]);

  const selectedLot = useMemo(() => {
    if (!selectedLotKey) return null;
    return results.find(l => l.uid === selectedLotKey);
  }, [selectedLotKey, results]);

  const filtered = useMemo(() => {
    let r = filterCat === "all" ? results : results.filter(l => l.category === filterCat);
    return [...r].sort((a, b) => sortBy === "npv" ? b.npvVsBid - a.npvVsBid : a.npvVsBid - b.npvVsBid);
  }, [results, filterCat, sortBy]);

  const best5 = [...results].sort((a, b) => b.npvVsBid - a.npvVsBid).slice(0, 5);
  const worst5 = [...results].sort((a, b) => a.npvVsBid - b.npvVsBid).slice(0, 5);

  const maxAbsVal = Math.max(...filtered.map(l => Math.abs(l.npvVsBid)));

  return (
    <div style={{ fontFamily: "'Georgia', 'Times New Roman', serif", background: "#f8fafc", minHeight: "100vh", color: "#1e293b", padding: "0" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)", borderBottom: "1px solid #2a2f3e", padding: "32px 32px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 6 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#64748b", fontFamily: "monospace" }}>Holstein Herd Dispersal</span>
            <span style={{ color: "#374151", fontSize: 11 }}>—</span>
            <span style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "#64748b", fontFamily: "monospace" }}>NPV Analysis</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.02em" }}>
            Lot Value Analysis
          </h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 13, fontStyle: "italic" }}>
            5-Year NPV vs. Auction Bid · 8% Discount · $19.00/cwt · Probability-weighted by Conception Rate & Survivability by Parity
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 32px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
          {/* Best deals */}
          <div style={{ background: "#ffffff", border: "1px solid #1f4f2f", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "#15803d", marginBottom: 10, fontFamily: "monospace" }}>▲ Best Value Lots</div>
            {best5.map(l => (
              <div key={`b-${l.uid}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 12, color: "#1e293b" }}>Lot {l.lot} — <span style={{ color: "#64748b", fontStyle: "italic" }}>{l.desc.slice(0, 34)}</span></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", fontFamily: "monospace" }}>+{fmt(l.npvVsBid)}</span>
              </div>
            ))}
          </div>
          {/* Worst deals */}
          <div style={{ background: "#ffffff", border: "1px solid #4f1f1f", borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "#dc2626", marginBottom: 10, fontFamily: "monospace" }}>▼ Worst Value Lots</div>
            {worst5.map(l => (
              <div key={`w-${l.uid}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 12, color: "#1e293b" }}>Lot {l.lot} — <span style={{ color: "#64748b", fontStyle: "italic" }}>{l.desc.slice(0, 34)}</span></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "monospace" }}>{fmt(l.npvVsBid)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buyer Profile Toggle */}
        <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10,
                     padding: "14px 20px", marginBottom: 12, display: "flex",
                     gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
                         color: "#64748b", fontFamily: "monospace", marginBottom: 4 }}>
              Buyer Profile
            </div>
            <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
              Same lot, different buyer = different NPV. Toggle between operational philosophies.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {["strict", "permissive"].map(prof => {
              const isActive = userAssumptions.buyerProfile === prof;
              const profile = userAssumptions.profiles[prof];
              return (
                <button key={prof}
                  onClick={() => setUserAssumptions({ ...userAssumptions, buyerProfile: prof })}
                  style={{
                    padding: "8px 14px", borderRadius: 8, fontSize: 11,
                    fontFamily: "monospace", cursor: "pointer", border: "1px solid",
                    background: isActive ? (prof === "strict" ? "#dcfce7" : "#fef3c7") : "transparent",
                    borderColor: isActive ? (prof === "strict" ? "#16a34a" : "#d97706") : "#cbd5e1",
                    color: isActive ? (prof === "strict" ? "#15803d" : "#92400e") : "#64748b",
                    textAlign: "left", minWidth: 240,
                  }}>
                  <div style={{ fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>
                    {profile.label}
                  </div>
                  <div style={{ fontSize: 9, fontStyle: "italic", opacity: 0.9 }}>
                    {profile.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Milk Price + Curve Summary Card */}
        <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10,
                     padding: "16px 20px", marginBottom: 16, display: "grid",
                     gridTemplateColumns: "2fr 3fr", gap: 20, alignItems: "center" }}>
          {/* Milk price slider */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
                         color: "#64748b", fontFamily: "monospace", marginBottom: 8 }}>
              Milk Price ($/cwt)
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#0f172a",
                            fontFamily: "monospace" }}>
                ${userAssumptions.milkPricePerCwt.toFixed(2)}
              </span>
              <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                per hundredweight
              </span>
            </div>
            <input type="range" min="14" max="26" step="0.25"
              value={userAssumptions.milkPricePerCwt}
              onChange={e => setUserAssumptions({
                ...userAssumptions,
                milkPricePerCwt: parseFloat(e.target.value),
              })}
              style={{ width: "100%", accentColor: "#16a34a", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9,
                         color: "#94a3b8", fontFamily: "monospace", marginTop: 4 }}>
              <span>$14</span>
              <span>$18</span>
              <span>$20</span>
              <span>$22</span>
              <span>$26</span>
            </div>
          </div>

          {/* Lactation curve summary */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
                         color: "#64748b", fontFamily: "monospace", marginBottom: 8 }}>
              Herd IOFC at ${userAssumptions.milkPricePerCwt.toFixed(2)}/cwt
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Cow curve */}
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 10px",
                           border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 9, color: "#64748b", fontFamily: "monospace",
                             letterSpacing: "0.1em", marginBottom: 4 }}>COW (2ND+ LACT)</div>
                {userAssumptions.lactationCurve.cow.map(s => {
                  const iofc = (s.milkLbs * userAssumptions.milkPricePerCwt / 100) - s.feedCost;
                  return (
                    <div key={s.stage} style={{ display: "flex", justifyContent: "space-between",
                                                 fontSize: 10, fontFamily: "monospace",
                                                 color: "#334155", marginBottom: 2 }}>
                      <span style={{ color: "#64748b" }}>{s.stage} ({s.days}d, {s.milkLbs}lb)</span>
                      <span style={{ fontWeight: 600, color: iofc >= 8 ? "#16a34a" : iofc >= 4 ? "#d97706" : "#dc2626" }}>
                        ${iofc.toFixed(2)}/d
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Heifer curve */}
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 10px",
                           border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 9, color: "#64748b", fontFamily: "monospace",
                             letterSpacing: "0.1em", marginBottom: 4 }}>HEIFER (1ST LACT)</div>
                {userAssumptions.lactationCurve.heifer.map(s => {
                  const iofc = (s.milkLbs * userAssumptions.milkPricePerCwt / 100) - s.feedCost;
                  return (
                    <div key={s.stage} style={{ display: "flex", justifyContent: "space-between",
                                                 fontSize: 10, fontFamily: "monospace",
                                                 color: "#334155", marginBottom: 2 }}>
                      <span style={{ color: "#64748b" }}>{s.stage} ({s.days}d, {s.milkLbs}lb)</span>
                      <span style={{ fontWeight: 600, color: iofc >= 8 ? "#16a34a" : iofc >= 4 ? "#d97706" : "#dc2626" }}>
                        ${iofc.toFixed(2)}/d
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Cull Price + Calf Price Sliders Card */}
        <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10,
                     padding: "16px 20px", marginBottom: 16, display: "grid",
                     gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

          {/* Cull price slider */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
                         color: "#64748b", fontFamily: "monospace", marginBottom: 8 }}>
              Beef Cull Price ($/lb)
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "#0f172a",
                            fontFamily: "monospace" }}>
                ${userAssumptions.cullValuePerLb.toFixed(2)}
              </span>
              <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
                per pound
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginLeft: "auto" }}>
                = ${(userAssumptions.cullValuePerLb * userAssumptions.cullCowWeightLbs).toLocaleString(undefined, {maximumFractionDigits: 0})} per cull cow
              </span>
            </div>
            <input type="range" min="0.80" max="1.80" step="0.05"
              value={userAssumptions.cullValuePerLb}
              onChange={e => setUserAssumptions({
                ...userAssumptions,
                cullValuePerLb: parseFloat(e.target.value),
              })}
              style={{ width: "100%", accentColor: "#d97706", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9,
                         color: "#94a3b8", fontFamily: "monospace", marginTop: 4 }}>
              <span>$0.80</span>
              <span>$1.00</span>
              <span>$1.20</span>
              <span>$1.40</span>
              <span>$1.60</span>
              <span>$1.80</span>
            </div>
          </div>

          {/* Angus calf slider */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
                         color: "#64748b", fontFamily: "monospace", marginBottom: 8 }}>
              Angus Calf Price
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "#0f172a",
                            fontFamily: "monospace" }}>
                ${userAssumptions.calfValueAngus.toLocaleString()}
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginLeft: "auto" }}>
                Holstein: ${(userAssumptions.calfValueAngus * userAssumptions.holsteinCalfRatio).toFixed(0)} ·
                Blended (50/50): ${((userAssumptions.calfValueAngus + userAssumptions.calfValueAngus * userAssumptions.holsteinCalfRatio)/2).toFixed(0)}
              </span>
            </div>
            <input type="range" min="1000" max="2400" step="50"
              value={userAssumptions.calfValueAngus}
              onChange={e => setUserAssumptions({
                ...userAssumptions,
                calfValueAngus: parseFloat(e.target.value),
              })}
              style={{ width: "100%", accentColor: "#a21caf", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9,
                         color: "#94a3b8", fontFamily: "monospace", marginTop: 4 }}>
              <span>$1,000</span>
              <span>$1,400</span>
              <span>$1,680</span>
              <span>$2,000</span>
              <span>$2,400</span>
            </div>
            <div style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", marginTop: 6, fontStyle: "italic" }}>
              Holstein calves priced at {(userAssumptions.holsteinCalfRatio * 100).toFixed(0)}% of Angus
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", letterSpacing: "0.1em" }}>FILTER:</span>
          {["all", "calves", "heifers", "bred_heifers", "milking", "dry"].map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)} style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace",
              letterSpacing: "0.08em", cursor: "pointer", border: "1px solid",
              background: filterCat === cat ? "#dcfce7" : "transparent",
              borderColor: filterCat === cat ? "#16a34a" : "#cbd5e1",
              color: filterCat === cat ? "#16a34a" : "#64748b",
              transition: "all 0.15s",
            }}>
              {cat === "all" ? "ALL LOTS" : CATEGORY_LABELS[cat]?.toUpperCase()}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", letterSpacing: "0.1em", alignSelf: "center" }}>SORT:</span>
            <button onClick={() => setSortBy("npv")} style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace",
              cursor: "pointer", border: "1px solid",
              background: sortBy === "npv" ? "#dbeafe" : "transparent",
              borderColor: sortBy === "npv" ? "#2563eb" : "#cbd5e1",
              color: sortBy === "npv" ? "#2563eb" : "#64748b",
            }}>BEST FIRST</button>
            <button onClick={() => setSortBy("worst")} style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace",
              cursor: "pointer", border: "1px solid",
              background: sortBy === "worst" ? "#fee2e2" : "transparent",
              borderColor: sortBy === "worst" ? "#dc2626" : "#cbd5e1",
              color: sortBy === "worst" ? "#dc2626" : "#64748b",
            }}>WORST FIRST</button>
          </div>
        </div>

        {/* Lot rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 40 }}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px 90px 90px 90px 110px 160px", gap: 12, padding: "6px 12px", borderBottom: "1px solid #1f2937" }}>
            {["LOT", "DESCRIPTION", "COMP%", "HEAD", "BID/HD", "NPV/HD", "NPV VS BID", ""].map((h, i) => (
              <span key={i} style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "monospace" }}>{h}</span>
            ))}
          </div>

          {filtered.map(lot => {
            const c = CATEGORY_COLORS[lot.category];
            const isPos = lot.npvVsBid >= 0;
            const barWidth = Math.min(100, (Math.abs(lot.npvVsBid) / maxAbsVal) * 100);
            const isHovered = hoveredLot === lot.uid;

            return (
              <div key={lot.uid}
                onClick={() => setSelectedLotKey(lot.uid)}
                onMouseEnter={() => setHoveredLot(lot.uid)}
                onMouseLeave={() => setHoveredLot(null)}
                style={{
                  display: "grid", gridTemplateColumns: "60px 1fr 70px 90px 90px 90px 110px 160px",
                  gap: 12, padding: "11px 12px", borderRadius: 8, cursor: "pointer",
                  background: isHovered ? "#f0f4f8" : "#ffffff",
                  border: `1px solid ${isHovered ? "#cbd5e1" : "#f0f4f8"}`,
                  transition: "all 0.12s",
                }}>

                {/* Lot # */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{lot.lot}</span>
                </div>

                {/* Description */}
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, color: "#111827", lineHeight: 1.3 }}>{lot.desc}</span>
                  <span style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace", marginTop: 2 }}>
                    {CATEGORY_LABELS[lot.category]}{lot.angus ? " · Angus ↑" : ""}{lot.threeT ? " · 3T ↓" : ""}
                  </span>
                </div>

                {/* Completion probability */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{
                    fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                    color: lot.completionProb >= 0.99 ? "#16a34a"
                         : lot.completionProb >= 0.93 ? "#a3e635"
                         : lot.completionProb >= 0.90 ? "#d97706"
                         : "#dc2626",
                  }}>
                    {(lot.completionProb * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Head */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{lot.hd}</span>
                </div>

                {/* Bid */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{fmt(lot.bid)}</span>
                </div>

                {/* NPV */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#1e293b", fontFamily: "monospace" }}>{fmt(lot.npv)}</span>
                </div>

                {/* NPV vs Bid */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                    color: isPos ? "#16a34a" : "#dc2626",
                  }}>
                    {isPos ? "+" : ""}{fmt(lot.npvVsBid)}
                  </span>
                </div>

                {/* Bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#334155", overflow: "hidden" }}>
                    <div style={{
                      width: `${barWidth}%`, height: "100%", borderRadius: 3,
                      background: isPos
                        ? `linear-gradient(90deg, #16a34a, #4ade80)`
                        : `linear-gradient(90deg, #dc2626, #f87171)`,
                      transition: "width 0.3s ease",
                      marginLeft: isPos ? 0 : "auto",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace", width: 38, textAlign: "right" }}>
                    {lot.roi >= 0 ? "+" : ""}{lot.roi.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footnote */}
        <div style={{ borderTop: "1px solid #1f2937", padding: "16px 0 32px", color: "#64748b", fontSize: 11, fontFamily: "monospace", lineHeight: 1.7 }}>
          <div style={{ marginBottom: 10, color: "#64748b", fontStyle: "italic" }}>💡 Click any lot row above to see detailed math breakdown</div>
          ASSUMPTIONS: Milk price adjustable via slider (default $19/cwt) · Heifer raising $3.25/d · Cull price adjustable via slider (default $1.20/lb × 1,400 lbs = $1,680) · Calf prices adjustable (default Angus $1,680, Holstein 60% = $1,008, blended $1,344) · 100% Angus lots: 43,56,66,83 · 8% discount · 5-yr projection | HERD LACTATION CURVE (user DHI data): COW 340d, 33,900 lbs — fresh 90lb/$8 feed, peak 125lb/$11.68, mid 105lb/$11.68, late 85lb/$8.96, far-late 65lb/$9.63 · HEIFER 330d, 29,040 lbs — fresh 80lb/$8.63, peak 98lb/$9.85, mid 85lb/$9.85, late 68lb/$8.63 | DRY PERIOD: 40d far-off @ $3.50/d + 20d close-up @ $6.00/d = $260 total | CALF DOA 5% · OPEN COWS: calf credited at conception+280d gestation · CALF SURVIVAL WEIGHT: only surviving cows produce next calf (pregnant 1st-cycle exempt) | BASELINE DEATH 1%/yr (zero salvage) | 3T COWS (Lots 77, 89): 20% milk revenue reduction for life | HEIFER SALVAGE: hutch $0 · corral $750 · open H $1,200 · AI H $1,980 · 1-4mo preg $2,070 · 5-9mo preg $2,340 · springer $2,520 | FRESH COW DEATH (zero salvage): L1 3% · L2 5% · L3 7% · L4 9% · L5+ 12% | TRANSPORT STRESS: springer +2% · close-up +5% · early-dry +1% | COMP%: L1 82% · L2 85% · L3 95% · open H 94% · AI H 91% · bred H 93% · springer 98% · milking/dry 100% | CCR: heifers 65%, L1 50%, L2 52%, L3 48%, L4 42%, declining | SURV (Hare 2006): L1→2 73%, 2→3 68.5%, 3→4 64%, 4→5 59.4%, 5→6 52.6%, 6→7 50%, 7→8 40% · preg boost · L2+ +2pts | BUYER PROFILE (toggleable): STRICT — DIM 275 hard cutoff, penalty from DIM 100 × 0.23 | PERMISSIVE — DIM 400 cutoff, penalty from DIM 200 × 0.15, 45% eventual CCR on late-DIM opens blended above DIM 200
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLot && (
        <LotDetailModal
          lot={selectedLot}
          assumptions={userAssumptions}
          onClose={() => setSelectedLotKey(null)}
        />
      )}
    </div>
  );
}

// ─── LOT DETAIL MODAL ───
function LotDetailModal({ lot, assumptions, onClose }) {
  const d = lot.detail;
  const isPos = lot.npvVsBid >= 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
        zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px", overflowY: "auto",
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff", border: "1px solid #1a2235", borderRadius: 12,
          maxWidth: 1000, width: "100%", color: "#334155",
          fontFamily: "'Georgia', serif", boxShadow: "0 20px 60px rgba(15,23,42,0.6)",
        }}>

        {/* Header */}
        <div style={{ padding: "22px 26px", borderBottom: "1px solid #1a2235",
                     background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
                     borderRadius: "12px 12px 0 0", position: "relative" }}>
          <button onClick={onClose} style={{
            position: "absolute", top: 16, right: 16, background: "#334155",
            border: "1px solid #2a3550", color: "#64748b", width: 32, height: 32,
            borderRadius: 8, cursor: "pointer", fontSize: 18, fontFamily: "monospace",
          }}>×</button>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <span style={{ background: "#eff6ff", border: "1px solid #1e3a5f", borderRadius: 5,
                          padding: "3px 10px", fontSize: 11, color: "#2563eb",
                          fontFamily: "monospace", letterSpacing: "0.1em" }}>LOT {lot.lot}</span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", letterSpacing: "0.08em" }}>
              {lot.hd} HEAD · {CATEGORY_LABELS[lot.category]?.toUpperCase()}
            </span>
            {lot.angus && <span style={{ fontSize: 10, color: "#a21caf", fontFamily: "monospace" }}>· ANGUS ↑</span>}
            {lot.threeT && <span style={{ fontSize: 10, color: "#ea580c", fontFamily: "monospace" }}>· 3T ↓</span>}
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
            {lot.desc}
          </h2>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 12, fontStyle: "italic" }}>
            Bid {fmt(lot.bid)}/hd · 5-yr NPV projection at 8% discount
          </p>

          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 16 }}>
            {[
              { label: "Auction Bid",      val: fmt(lot.bid),                             color: "#64748b" },
              { label: "5-Yr NPV",         val: fmt(lot.npv),                             color: "#2563eb" },
              { label: "NPV vs Bid",       val: (isPos?"+":"") + fmt(lot.npvVsBid),       color: isPos ? "#059669" : "#dc2626" },
              { label: `Total (${lot.hd} hd)`, val: (isPos?"+":"") + fmt(lot.npvVsBid * lot.hd), color: "#d97706" },
            ].map(k => (
              <div key={k.label} style={{ background: "#f8fafc", border: "1px solid #1a2235",
                                          borderRadius: 7, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.1em",
                             textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Animal parameters */}
        <div style={{ padding: "14px 26px", borderBottom: "1px solid #1a2235", background: "#f1f5f9" }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em",
                       textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>
            Animal Parameters
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, fontSize: 11 }}>
            {[
              ["Completion %",       (lot.completionProb * 100).toFixed(0) + "%"],
              ["Starting lactation", lot.lactation || "—"],
              ["DIM range",          lot.dimFrom || lot.dimTo ? `${lot.dimFrom}–${lot.dimTo}` : "—"],
              ["Pregnancy",          lot.pregMonth ? `${lot.pregMonth} mo` : "Open/N/A"],
              ["Days until fresh",   d.freshDay],
              ["Raising cost total", fmt(-d.totalRaisingCost)],
              ["Calf value",         fmt(d.calfValue)],
              ["Transport stress",   d.transportStressExtra > 0 ? `+${(d.transportStressExtra*100).toFixed(0)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "#f8fafc", border: "1px solid #1a2235",
                                    borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.08em",
                             textTransform: "uppercase", fontFamily: "monospace", marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 12, color: "#1e293b", fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Lactation-by-lactation breakdown */}
        {d.lactationDetails.length > 0 && (
          <div style={{ padding: "16px 26px", borderBottom: "1px solid #1a2235" }}>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em",
                         textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>
              Lactation-by-Lactation Trace
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a2235" }}>
                    {["Lact", "cumSurv In", "Fresh Death", "cumSurv After", "CCR", "Base Days", "xOpen Days",
                      "Milk Rev", "xOpen Rev", "Calf", "Dry Cost", "Exit Prob", "Exit Cull"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "right", fontSize: 8,
                                          color: "#64748b", fontFamily: "monospace", fontWeight: 400,
                                          letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.lactationDetails.map((ld, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1a2235" }}>
                      <td style={{ padding: "8px", textAlign: "right", color: "#7c3aed",
                                   fontFamily: "monospace", fontWeight: 700 }}>{ld.lact}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {(ld.cumSurvBefore * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ld.freshDeathHit > 0 ? "#dc2626" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ld.freshDeathHit > 0 ? `−${(ld.freshDeathHit*100).toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#1e293b", fontFamily: "monospace", fontWeight: 600 }}>
                        {(ld.cumSurvAfterFreshDeath * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {(ld.ccr * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {ld.milkDaysUsed}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {ld.xDaysUsed}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#059669", fontFamily: "monospace" }}>
                        {fmt(ld.milkRev)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#047857", fontFamily: "monospace" }}>
                        {ld.xOpenRev > 0 ? fmt(ld.xOpenRev) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#a21caf", fontFamily: "monospace" }}>
                        {ld.calfRev > 0 ? fmt(ld.calfRev) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#dc2626", fontFamily: "monospace" }}>
                        {ld.dryRev < 0 ? fmt(ld.dryRev) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {(ld.exitProb * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#d97706", fontFamily: "monospace" }}>
                        {ld.exitCullRev > 0 ? fmt(ld.exitCullRev) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Annual cash flows */}
        <div style={{ padding: "16px 26px" }}>
          <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em",
                       textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>
            Annual Cash Flow Summary (per head)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a2235" }}>
                  {["Yr", "Raising", "Salvage", "Milk", "xOpen", "Calf", "Dry", "Exit Cull", "Term Cull",
                    "Net CF", "Disc", "PV"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "right", fontSize: 8,
                                        color: "#64748b", fontFamily: "monospace", fontWeight: 400,
                                        letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.annualDetail.map((ad, i) => {
                  const cf = lot.cashFlows[i];
                  const df = 1 / Math.pow(1 + assumptions.discountRate, i + 1);
                  const pv = cf * df;
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #1a2235" }}>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b",
                                   fontFamily: "monospace", fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.raising < 0 ? "#ea580c" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.raising < 0 ? fmt(ad.raising) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.nonCompletionSalvage > 0 ? "#d97706" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.nonCompletionSalvage > 0 ? fmt(ad.nonCompletionSalvage) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.milk > 0 ? "#059669" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.milk > 0 ? fmt(ad.milk) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.xOpen > 0 ? "#047857" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.xOpen > 0 ? fmt(ad.xOpen) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.calf > 0 ? "#a21caf" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.calf > 0 ? fmt(ad.calf) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.dry < 0 ? "#dc2626" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.dry < 0 ? fmt(ad.dry) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.exitCull > 0 ? "#d97706" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.exitCull > 0 ? fmt(ad.exitCull) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: ad.termCull > 0 ? "#d97706" : "#64748b",
                                   fontFamily: "monospace" }}>
                        {ad.termCull > 0 ? fmt(ad.termCull) : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: 700,
                                   color: cf >= 0 ? "#2563eb" : "#dc2626", fontFamily: "monospace" }}>
                        {fmt(cf)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#64748b", fontFamily: "monospace" }}>
                        {df.toFixed(4)}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: 700,
                                   color: "#334155", fontFamily: "monospace" }}>
                        {fmt(pv)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #2a3550", background: "#f1f5f9" }}>
                  <td colSpan={9} style={{ padding: "10px 8px", textAlign: "right", fontSize: 10,
                                           color: "#64748b", fontFamily: "monospace", letterSpacing: "0.08em" }}>
                    SUM →
                  </td>
                  <td style={{ padding: "10px 8px", textAlign: "right", color: "#2563eb",
                               fontFamily: "monospace", fontWeight: 700 }}>
                    {fmt(lot.totalUndiscounted)}
                  </td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontSize: 9,
                               color: "#64748b", fontFamily: "monospace" }}>NPV →</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", color: "#2563eb",
                               fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>
                    {fmt(lot.npv)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Close button at bottom */}
        <div style={{ padding: "14px 26px 20px", borderTop: "1px solid #1a2235",
                     display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: "#334155", border: "1px solid #2a3550", color: "#334155",
            padding: "8px 18px", borderRadius: 7, cursor: "pointer",
            fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em",
          }}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
