// Deterministic federal election-calendar facts, computed from fixed
// constitutional/statutory rules — never a live lookup, never stale:
//   - General elections: the first Tuesday after the first Monday in
//     November, every even year (2 U.S.C. §7 for the House/Senate,
//     3 U.S.C. §1 for presidential electors).
//   - A new Congress convenes January 3 of every odd year (US Const.
//     amend. XX).
//   - A presidential term begins January 20 following a presidential-
//     election year (a year divisible by 4).
// Used by functions/api/strategic-plan.js to ground any electoral
// strategic goal in a real date instead of an AI guess. Deliberately does
// NOT cover state or local election calendars (gubernatorial cycles,
// state legislature election years, mayoral terms) — those vary by
// state/city and no source for them exists anywhere in this repo; see
// CLAUDE.md's "Beyond legislative roadmap" note on Elections & ballot
// measures.

export function generalElectionDateForYear(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const daysToMonday = (1 - nov1.getUTCDay() + 7) % 7; // Monday = 1 in getUTCDay()
  const firstMonday = 1 + daysToMonday;
  return new Date(Date.UTC(year, 10, firstMonday + 1)); // Tuesday right after
}

export function isPresidentialElectionYear(year) {
  return year % 4 === 0;
}

export function nextGeneralElectionDate(fromDate) {
  fromDate = fromDate || new Date();
  let year = fromDate.getUTCFullYear();
  if (year % 2 !== 0) year += 1;
  let candidate = generalElectionDateForYear(year);
  if (candidate < fromDate) {
    year += 2;
    candidate = generalElectionDateForYear(year);
  }
  return candidate;
}

function convenedYearFor(fromDate) {
  const year = fromDate.getUTCFullYear();
  const beforeJan3 = fromDate.getUTCMonth() === 0 && fromDate.getUTCDate() < 3;
  let convened = year % 2 === 1 ? year : year - 1;
  if (year % 2 === 1 && beforeJan3) convened -= 2;
  return convened;
}

// The 1st Congress convened in 1789; each Congress spans two years.
export function currentCongressNumber(fromDate) {
  fromDate = fromDate || new Date();
  return Math.floor((convenedYearFor(fromDate) - 1789) / 2) + 1;
}

export function currentCongressConveneDate(fromDate) {
  fromDate = fromDate || new Date();
  return new Date(Date.UTC(convenedYearFor(fromDate), 0, 3));
}

export function nextCongressConveneDate(fromDate) {
  fromDate = fromDate || new Date();
  const year = fromDate.getUTCFullYear();
  let targetYear = year % 2 === 1 ? year + 2 : year + 1;
  const candidate = new Date(Date.UTC(targetYear, 0, 3));
  return candidate < fromDate ? new Date(Date.UTC(targetYear + 2, 0, 3)) : candidate;
}

export function nextInaugurationDate(fromDate) {
  fromDate = fromDate || new Date();
  let year = fromDate.getUTCFullYear();
  for (;;) {
    if (isPresidentialElectionYear(year)) {
      const inauguration = new Date(Date.UTC(year + 1, 0, 20));
      if (inauguration >= fromDate) return inauguration;
    }
    year += 1;
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// One-call aggregate — everything strategic-plan.js interpolates into its
// prompt, as plain ISO date strings.
export function electionFacts(fromDate) {
  fromDate = fromDate || new Date();
  const nextGeneral = nextGeneralElectionDate(fromDate);
  return {
    todayISO: isoDate(fromDate),
    nextGeneralElectionDateISO: isoDate(nextGeneral),
    isNextElectionPresidential: isPresidentialElectionYear(nextGeneral.getUTCFullYear()),
    currentCongressNumber: currentCongressNumber(fromDate),
    currentCongressConveneDateISO: isoDate(currentCongressConveneDate(fromDate)),
    nextCongressConveneDateISO: isoDate(nextCongressConveneDate(fromDate)),
    nextInaugurationDateISO: isoDate(nextInaugurationDate(fromDate))
  };
}
