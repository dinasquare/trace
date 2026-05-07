from typing import Iterable
from schema import Distinctiveness, Finding, LeakCategory, RiskScore

DISTINCTIVENESS_FRACTION: dict[Distinctiveness, float] = {
    Distinctiveness.COMMON:               0.30,
    Distinctiveness.SOMEWHAT_DISTINCTIVE: 0.05,
    Distinctiveness.HIGHLY_DISTINCTIVE:   1e-4,
}

CORRELATION_GROUPS: dict[str, set[LeakCategory]] = {
    "geo": {LeakCategory.LOCATION},
    "demographics": {LeakCategory.AGE, LeakCategory.GENDER},
    "work_edu": {LeakCategory.OCCUPATION, LeakCategory.EDUCATION},
    "personal": {
        LeakCategory.RELATIONSHIP,
        LeakCategory.FAMILY,
        LeakCategory.HEALTH,
        LeakCategory.LIFE_EVENT,
    },
    "style": {LeakCategory.WRITING_STYLE, LeakCategory.LINKABLE_PHRASE},
    "interests": {LeakCategory.INTERESTS},
}

WORLD_POPULATION = 8_000_000_000
MIN_JOINT_FRACTION = 1.0 / WORLD_POPULATION


def _dampening_exponent(rank_in_group: int) -> float:
    return 1.0 / (rank_in_group + 1)


def score_report(findings: Iterable[Finding]) -> RiskScore:
    findings = list(findings)
    if not findings:
        return RiskScore(
            joint_fraction=1.0,
            matching_population=WORLD_POPULATION,
            headline="No identifying information detected.",
            band="low",
            explanation="The extractor returned no findings.",
        )

    # bucket findings into groups
    grouped: dict[str, list[Finding]] = {}
    for f in findings:
        group = _group_for(f.category)
        grouped.setdefault(group, []).append(f)

    # scoring loop
    joint_fraction = 1.0
    contributions: list[tuple[Finding, float]] = []

    for group_findings in grouped.values():
        group_findings.sort(
            key=lambda f: DISTINCTIVENESS_FRACTION[f.distinctiveness]
        )
        for rank, finding in enumerate(group_findings):
            raw = DISTINCTIVENESS_FRACTION[finding.distinctiveness]
            exponent = _dampening_exponent(rank)
            dampened = raw ** exponent
            joint_fraction *= dampened
            contributions.append((finding, dampened))

    # floor and convert to headcount
    joint_fraction = max(joint_fraction, MIN_JOINT_FRACTION)
    matching_population = max(1, round(WORLD_POPULATION * joint_fraction))
    matching_population = _round_to_one_sig_fig(matching_population)

    # cap band based on what signals actually exist —
    # prevents LLM inconsistency from triggering severe on vague posts
    has_highly_distinctive = any(
        f.distinctiveness == Distinctiveness.HIGHLY_DISTINCTIVE for f in findings
    )
    has_somewhat_distinctive = any(
        f.distinctiveness == Distinctiveness.SOMEWHAT_DISTINCTIVE for f in findings
    )

    band = _band_for(matching_population)

    if band == "severe" and not has_highly_distinctive:
        band = "high"
    if band == "high" and not has_somewhat_distinctive and not has_highly_distinctive:
        band = "moderate"

    headline = _format_headline(matching_population)
    explanation = _explain(contributions, matching_population)

    return RiskScore(
        joint_fraction=joint_fraction,
        matching_population=matching_population,
        headline=headline,
        band=band,
        explanation=explanation,
    )


def _group_for(category: LeakCategory) -> str:
    for group_name, members in CORRELATION_GROUPS.items():
        if category in members:
            return group_name
    return f"_solo_{category.value}"


def _round_to_one_sig_fig(n: int) -> int:
    if n <= 0:
        return 1
    from math import floor, log10
    digits = floor(log10(n))
    factor = 10 ** digits
    return int(round(n / factor) * factor)


def _format_headline(n: int) -> str:
    if n >= WORLD_POPULATION * 0.5:
        return "Effectively no identifying signal in this text."
    if n >= 1_000_000:
        return f"Roughly 1 in {n // 1_000_000:,} million people match this profile."
    if n >= 1_000:
        return f"Roughly 1 in {n:,} people match this profile."
    if n > 1:
        return f"Only about {n} people on Earth match this profile."
    return "This profile is essentially unique."


def _band_for(n: int) -> str:
    if n >= 5_000_000:
        return "low"
    if n >= 100_000:
        return "moderate"
    if n >= 5_000:
        return "high"
    return "severe"


def _explain(contributions: list[tuple[Finding, float]], matching: int) -> str:
    contributions.sort(key=lambda c: c[1])
    top = contributions[:min(3, len(contributions))]
    parts = [f"{f.category.value} ({f.distinctiveness.value})" for f, _ in top]
    joined = ", ".join(parts)
    return (
        f"Estimated ~{matching:,} people match all detected attributes "
        f"(heuristic, with correlation dampening). Strongest signals: {joined}."
    )