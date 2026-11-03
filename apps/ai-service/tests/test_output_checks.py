import pytest

from app.engine import DEFAULT_FACTS
from app.guardrails import check_reply
from dataset.schema import Turn
from dataset.synthetic import Business

B = Business.load(DEFAULT_FACTS)
FIRST = B.services[0]


def c(*texts: str) -> list[Turn]:
    return [Turn("customer", t) for t in texts]


@pytest.mark.parametrize(
    "history, reply",
    [
        (c("What are your opening hours?"), f"We are open {B.hours['weekdays']} on weekdays."),
        (c(f"How much is a {FIRST['name']}?"), f"A {FIRST['name']} costs {FIRST['price']} and takes about {FIRST['duration']}."),
        (c("What is your phone number?"), f"You can call us on {B.phone} or email {B.email}."),
        (
            c("I want to book an appointment", f"A {FIRST['name']} on Tuesday at 10am. My name is Maria"),
            f"Thank you, Maria. I have passed your request for a {FIRST['name']} on Tuesday at 10am to our team. "
            f"They will confirm with you shortly. The {FIRST['name']} costs {FIRST['price']}.",
        ),
        (c("Thanks"), f"Goodbye! Thank you for contacting {B.name}."),
    ],
)
def test_grounded_replies_pass(history: list[Turn], reply: str) -> None:
    assert check_reply(reply, history, B) is None


@pytest.mark.parametrize(
    "history, reply, reason, detail",
    [
        # The real failure from evaluation: an invented booking for an off-topic question.
        (
            c("Can you recommend a good restaurant?"),
            "Thank you, Aisha. I have passed your request for a vaccination on Saturday to our team.",
            "ungrounded",
            "name",
        ),
        (
            c("I want a dental check-up, my name is Ravi"),
            "Thank you, Ravi. I have passed your request for a dental check-up on Monday to our team.",
            "ungrounded",
            "booking_details",
        ),
        (c(f"How much is a {FIRST['name']}?"), f"A {FIRST['name']} costs $999.", "ungrounded", "price"),
        (c(f"How much is a {FIRST['name']}?"), f"A {FIRST['name']} costs {B.services[1]['price']}.", "ungrounded", "price"),
        (c("What is your number?"), "Call us on +1 555 999 0000.", "ungrounded", "phone"),
        (c("What is your email?"), "Email us at bookings@other.example.", "ungrounded", "email"),
        (c("Book me in for Monday"), "Done! Your appointment is confirmed for Monday.", "action_claim", None),
        (c("Book me in"), "I've booked you in.", "action_claim", None),
        (c("Cancel it"), "We have cancelled your booking.", "action_claim", None),
        (c("I have a headache"), "Take 400 mg of ibuprofen.", "medical_content", None),
    ],
)
def test_unsupported_replies_are_rejected(history: list[Turn], reply: str, reason: str, detail: str | None) -> None:
    issue = check_reply(reply, history, B)
    assert issue is not None and issue.reason == reason
    if detail:
        assert issue.detail == detail


def test_phone_numbers_the_customer_gave_are_allowed() -> None:
    history = c("Please call me on 07700 900123")
    assert check_reply("Sure, our team will call you on 07700 900123.", history, B) is None
