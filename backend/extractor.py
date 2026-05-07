import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
from schema import Finding, LeakReport
import time
from google.genai import errors
from scoring import score_report

load_dotenv()

_api_key = os.getenv("GEMINI_API_KEY")
if not _api_key:
    raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file or environment.")

client = genai.Client(api_key=_api_key)

SYSTEM_PROMPT = """You are a privacy auditor. The user will give you a draft social media post or comment they are about to publish under a pseudonym. Your job is to identify every piece of information in the text that could help an attacker deanonymize the author or narrow down their real identity.

You are NOT trying to scare the user. You are trying to give them an honest, calibrated audit of what their text reveals.

For each leak you find, you must return:
- category: one of the allowed enum values
- inference: in plain language, what an attacker could conclude (e.g. "author lives in northern India", "author is in their late 20s")
- evidence_span: the EXACT substring from the user's text that reveals this. It must appear verbatim, character-for-character, in the input. Do not paraphrase. Do not summarize. If the evidence is spread across multiple phrases, pick the single most revealing one.
- reasoning: one sentence on why this phrase reveals this inference
- confidence: how sure you are that this inference is correct (low / medium / high)
- distinctiveness: how rare this attribute is in the general population
    - common: shared by hundreds of millions of people (e.g. "I'm a software engineer", "I like coffee")
    - somewhat_distinctive: narrows to a city, a profession + region, a niche hobby (e.g. "I work in fintech in Bangalore")
    - highly_distinctive: narrows to a small group of people, possibly a single person (e.g. mentions a specific employer + role + city, a rare medical condition, a unique life event)

Rules you must follow:
1. Only flag things that are actually in the text. Do not speculate beyond the evidence.
2. The evidence_span must be a verbatim substring of the input. This is critical.
3. Prefer fewer, high-quality findings over many weak ones. If a "leak" requires three layers of speculation, don't include it.
4. Pay special attention to combinations: a single attribute may be common, but two or three together may be highly distinctive. Note this in your reasoning when relevant.
5. Watch for: place-specific references (local landmarks, regional slang, weather, time zones), temporal markers (recent events, "last year I…"), professional jargon that pins down an industry, family/relationship details, health info, distinctive idioms or non-native English patterns that suggest a region.
6. The "linkable_phrase" category is for phrases so specific they could plausibly be googled to find the person (e.g. an unusual project name, a quote from a small event, a niche username).

After listing findings, give an overall_risk rating and a one-or-two sentence summary of the biggest concerns. If the text reveals essentially nothing, return an empty findings list and say so honestly."""


def analyze(text: str, max_retries: int = 3) -> LeakReport:
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=text,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=LeakReport,
                    temperature=0.2,
                ),
            )
            report = LeakReport.model_validate_json(response.text)
            report.risk = score_report(report.findings)
            return report
        except errors.ServerError as e :
            if attempt == max_retries-1:
                raise
            wait = 2**attempt
            print(f"Server busy, retrying in {wait}s....")
            time.sleep(wait)

REWRITE_PROMPT = """You are a privacy editor. The user has a piece of text with a privacy leak identified in it.

Your job: suggest the MINIMUM edit to the evidence_span that removes or obscures the identifying signal, while keeping the sentence readable and natural.

Rules:
1. Only change the evidence_span. Do not rewrite the whole sentence.
2. Keep the same general meaning and tone — just make it less identifying.
3. If the span is a specific location, generalize it (e.g. "Gomti riverfront" → "a nearby river path").
4. If the span is a specific role/employer, generalize it (e.g. "backend dev at a fintech startup" → "a developer role").
5. If the span reveals age, soften it (e.g. "after 35" → "at a certain age").
6. Return ONLY valid JSON. No preamble. No explanation outside the JSON.

Return this exact shape:
{
  "original": "<the exact evidence_span from the input>",
  "suggestion": "<your replacement text>",
  "delta": "<one short sentence explaining what you changed and why>"
}"""


def rewrite_suggestion(text: str, finding: Finding) -> dict:
    evidence = finding.evidence_span
    inference = finding.inference
    category = finding.category.value

    prompt = f"""Text: {text}

Finding:
- evidence_span: "{evidence}"
- inference: {inference}
- category: {category}

Suggest a minimal rewrite of the evidence_span that removes this identifying signal."""

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=REWRITE_PROMPT,
                    response_mime_type="application/json",
                    temperature=0.3,
                ),
            )
            raw = response.text.strip()
            return json.loads(raw)
        except errors.ServerError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
        except json.JSONDecodeError:
            # Gemini occasionally wraps in markdown fences despite mime type
            cleaned = raw.removeprefix("```json").removesuffix("```").strip()
            return json.loads(cleaned)

if __name__ == "__main__":
    sample = """Just got back from my morning run along the Gomti riverfront, finally cooling down after that brutal summer. Starting my new role as a backend dev at a fintech startup next Monday — they're letting me work hybrid which is great because my daughter just started kindergarten and drop-off is chaos. Also, anyone else's knees hate them after 35? Asking for a friend."""
    # sample = """Just had a really good cup of coffee. The weather's nice today. Might go for a walk later, who knows."""

    report = analyze(sample)
    print(json.dumps(report.model_dump(), indent=2))