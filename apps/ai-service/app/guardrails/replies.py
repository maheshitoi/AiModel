"""Fixed replies for messages the model must not answer. Edit the business facts, not these templates."""

from __future__ import annotations

from dataset.synthetic import Business

DEFAULT_FALLBACK = "Thanks for your message. A team member will get back to you shortly."


def safety_reply(category: str, business: Business) -> str:
    if category == "emergency":
        return f"{business.emergency_note} Please do not wait for a reply here."
    if category == "self_harm":
        return (
            "I'm really sorry you're going through this. If you are in danger or might act on these thoughts, "
            "please call your local emergency number now, or contact a crisis helpline in your country. "
            "You don't have to face this alone."
        )
    if category == "medical_advice":
        return (
            "I'm sorry, I can't give medical advice by message. A member of our team will get back to you, "
            f"or you can call us on {business.phone}. If it is urgent, please call your local emergency number."
        )
    if category == "human_request":
        return f"Of course. A member of our team will reply to you here as soon as possible. You can also call us on {business.phone}."
    raise ValueError(f"no fixed reply for category {category!r}")
