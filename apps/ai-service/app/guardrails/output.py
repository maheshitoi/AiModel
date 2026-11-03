"""Checks on what the model wrote, before anyone can send it.

The model invents plausible details when it is unsure (a booking confirmation with a made-up name
was its typical failure in evaluation). These checks reject replies that claim an action was done or
state a detail that neither the customer nor the business facts support.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from dataset.schema import Turn
from dataset.synthetic import Business

from .safety import normalize

# The assistant can't book, cancel or charge anything; only staff (or a future booking integration) can.
_ACTION_CLAIM = re.compile(
    r"\b(?:i|we)(?: have|'ve)? (?:booked|scheduled|reserved|confirmed|cancell?ed|rescheduled|charged|refunded)\b"
    r"|\b(?:your|the) (?:appointment|booking|reservation|slot|visit)(?: is| has been| was) (?:now )?(?:booked|confirmed|scheduled|reserved|cancell?ed|rescheduled)\b"
    r"|\b(?:you are|you're) (?:booked|confirmed|all set)\b"
    r"|\bsee you (?:on|at|then|tomorrow)\b"
)
_DOSAGE = re.compile(r"\b\d+(?:\.\d+)?\s?(?:mg|ml|mcg|pills?|tablets?|capsules?|drops)\b")
_NAME = re.compile(r"\b(?:Thank you|Thanks|Hi|Hello|Dear),? ([A-Z][a-z]+)\b")
_REQUEST = re.compile(r"request for (?:an? )?(?P<service>[a-z][a-z -]*?) on (?P<day>[a-z]+)(?: at (?P<time>\d[\d:]*\s?(?:am|pm)?|morning|afternoon|evening))?\b")
_MONEY = re.compile(r"[$€£₹]\s?\d[\d,]*(?:\.\d+)?")
_PHONE = re.compile(r"\+?\d[\d\s().-]{6,}\d")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


@dataclass(frozen=True)
class OutputIssue:
    reason: str  # action_claim | medical_content | ungrounded
    detail: str


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def check_reply(reply: str, history: list[Turn], business: Business) -> OutputIssue | None:
    text = normalize(reply)
    customer = normalize(" \n ".join(t.text for t in history if t.role == "customer"))
    customer_words = set(re.findall(r"[a-z]+", customer))

    if _ACTION_CLAIM.search(text):
        return OutputIssue("action_claim", "claims an action was completed")
    if _DOSAGE.search(text):
        return OutputIssue("medical_content", "mentions a dosage")

    business_words = set(re.findall(r"[a-z]+", normalize(f"{business.name} {business.assistant_name}")))
    for name in _NAME.findall(reply):
        if name.lower() not in customer_words | business_words:
            return OutputIssue("ungrounded", "name")

    for m in _REQUEST.finditer(text):
        details = [m["service"], m["day"]] + ([m["time"]] if m["time"] else [])
        if any(_compact(d) not in _compact(customer) for d in details):
            return OutputIssue("ungrounded", "booking_details")

    prices = {_compact(normalize(s["price"])) for s in business.services}
    amounts = [_compact(a) for a in _MONEY.findall(text)]
    if any(a not in prices for a in amounts):
        return OutputIssue("ungrounded", "price")
    mentioned = [s for s in business.services if normalize(s["name"]) in text]
    if amounts and len(mentioned) == 1 and _compact(normalize(mentioned[0]["price"])) not in amounts:
        return OutputIssue("ungrounded", "price")

    for phone in _PHONE.findall(text):
        if _digits(phone) not in (_digits(business.phone), *(_digits(p) for p in _PHONE.findall(customer))):
            return OutputIssue("ungrounded", "phone")
    for email in _EMAIL.findall(text):
        if email not in (business.email.lower(), *_EMAIL.findall(customer)):
            return OutputIssue("ungrounded", "email")
    return None
