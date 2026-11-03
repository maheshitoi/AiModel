"""Deterministic rules that run before the model sees a message.

The trained model failed every safety prompt in evaluation (docs/training.md), so emergencies,
self-harm, medical-advice requests and requests for a person never reach it: they get a fixed reply
and are flagged for a human. The rules are keyword patterns. They catch common English phrasing,
not every way of saying something. They will miss misspellings, slang and other languages, and they
deliberately err towards escalating.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from dataset.schema import Turn

_QUOTES = str.maketrans({"’": "'", "‘": "'", "`": "'", "´": "'"})

_NEG = r"(?:can'?t|cannot|can not|unable to|isn'?t|is not|not|stopped|struggling to|trouble|difficulty|hard to)"
_DRUG = r"(?:pills?|tablets?|medicines?|medications?|meds|doses?|dosage|antibiotics?|painkillers?|ibuprofen|paracetamol|aspirin|insulin|mg|drugs?|drops)\b"
_PRONOUN = r"(?:my|his|her|their)"

# Checked in this order; the first category with a matching rule wins.
_RULES: dict[str, list[tuple[str, str]]] = {
    "self_harm": [
        ("kill_self", r"\bkill(?:ing)? my ?self\b"),
        ("harm_self", r"\b(?:want|wanna|going|trying|tried|thinking about|think about) (?:to )?(?:hurt|harm|hurting|harming) my ?self\b"),
        ("suicide", r"\bsuicid"),
        ("end_life", r"\b(?:end|take) my (?:own )?life\b|\bend it all\b"),
        ("want_to_die", r"\b(?:want|wanna|ready) to die\b|\bdon'?t want to (?:live|be alive|wake up)\b|\bno reason to live\b|\bbetter off dead\b"),
        ("self_harm", r"\bself[- ]?harm"),
    ],
    "emergency": [
        ("breathing", rf"\b{_NEG} (?:breath|breathe|breathing)\b|\bshort(?:ness)? of breath\b|\bcan'?t catch {_PRONOUN} breath\b"),
        ("unconscious", r"\b(?:collaps\w*|unconscious|unresponsive|passed out|passing out|faint(?:ed|ing)?|blacked out)\b|\b(?:not|isn'?t|won'?t|wont) (?:waking|wake) up\b"),
        ("cardiac", r"\bheart attack\b|\bchest pains?\b|\bcardiac\b"),
        ("stroke", r"\bstroke\b|\bface (?:is )?drooping\b|\bslurred speech\b"),
        ("seizure", r"\bseizures?\b|\bconvuls\w*"),
        (
            "bleeding",
            r"\bbleed\w* (?:a lot|heavily|badly|profusely|everywhere|non-?stop)\b|\b(?:won'?t|will not|doesn'?t|does not|can'?t) stop bleeding\b"
            r"|\b(?:heavy|severe|lots of|a lot of|so much) (?:bleeding|blood)\b|\blosing (?:a lot of )?blood\b",
        ),
        ("poisoning", r"\boverdos\w*|\bpoison\w*|\bswallowed\b"),
        ("choking", r"\bchok(?:e|ed|es|ing)\b"),
        ("allergy", r"\banaphyla\w*|\ballergic reaction\b|\b(?:throat|tongue|lips|face) (?:is |are )?(?:swelling|swollen|closing)\b|\bswollen (?:throat|tongue)\b"),
        ("injury", rf"\baccident\b|\bhead injury\b|\bhit {_PRONOUN} head\b|\bbroken (?:bone|leg|arm|neck|back)\b|\bsevere (?:pain|burns?|injury|headache)\b"),
        ("dying", r"\b(?:is|he'?s|she'?s|they'?re|they are) dying\b|\b(?:is|he'?s|she'?s) not moving\b"),
        ("emergency", r"\bemergency\b|\bambulance\b|\b(?:911|999|112)\b"),
    ],
    "medical_advice": [
        ("which_medicine", r"\b(?:what|which) (?:medicines?|medications?|meds|drugs?|pills?|tablets?|antibiotics?|cream|ointment|treatment|dose|dosage)\b"),
        ("take_medicine", rf"\b(?:should|can|could|may|do) i (?:take|use|stop|double|increase|reduce|mix|combine|skip)\b.*\b{_DRUG}"),
        ("dose", rf"\b(?:how (?:much|many)|what dose|what dosage|maximum dose|max dose)\b.*\b{_DRUG}"),
        ("double_dose", rf"\bdouble (?:my|the|his|her|their) (?:dose|dosage|pills|tablets|medication|meds|medicine)\b"),
        ("safe_to", r"\bis it (?:safe|ok|okay|dangerous) to (?:take|mix|combine|drink|use|eat)\b"),
        ("drug_name", r"\b(?:antibiotics?|painkillers?|ibuprofen|paracetamol|acetaminophen|aspirin|insulin|codeine|steroids?|antidepressants?)\b"),
        (
            "diagnosis",
            r"\bdiagnos\w*|\bwhat(?:'s| is) wrong with (?:me|my|him|her|them)\b|\bis (?:this|it|that|my) (?:\w+ ){0,2}(?:normal|serious|dangerous|cancer|infected)\b"
            r"|\bdo (?:i|you think i) (?:have|need) (?:a |an )?(?:surgery|operation|cancer|diabetes|infection|stitches|antibiotics)\b",
        ),
        ("symptoms", r"\bsymptoms?\b|\bside effects?\b"),
        ("prescription", r"\bprescri\w*"),
        ("treatment", rf"\b(?:treat|cure|heal|get rid of) (?:my|a|the|this|his|her|their)\b"),
    ],
    "human_request": [
        ("talk_to_person", r"\b(?:talk|speak|chat) (?:to|with) (?:a |an |the |your |some(?:one|body) )?(?:real |actual )?(?:human|person|someone|somebody|staff|receptionist|agent|manager|team|people)\b"),
        ("real_person", r"\b(?:real|actual|live) (?:person|human|agent)\b"),
        ("connect_me", r"\b(?:connect|transfer|put) me (?:to|through)\b"),
        ("call_me", r"\b(?:call|ring|phone) me\b"),
    ],
}
_COMPILED = {category: [(name, re.compile(pattern)) for name, pattern in rules] for category, rules in _RULES.items()}
CATEGORIES = tuple(_RULES)


@dataclass(frozen=True)
class SafetyMatch:
    category: str  # self_harm | emergency | medical_advice | human_request
    rule: str  # which rule matched (safe to log: never contains message text)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES).lower()
    return re.sub(r"\s+", " ", text).strip()


def pending_customer_text(history: list[Turn]) -> str:
    """The customer messages that arrived since the last assistant turn (customers often split one thought)."""
    pending: list[str] = []
    for turn in reversed(history):
        if turn.role != "customer":
            break
        pending.append(turn.text)
    return "\n".join(reversed(pending))


def check_message(text: str) -> SafetyMatch | None:
    normalized = normalize(text)
    for category, rules in _COMPILED.items():
        for name, pattern in rules:
            if pattern.search(normalized):
                return SafetyMatch(category, name)
    return None
