"""Template-based synthetic customer-service conversations built from config/business.json.

Purpose: bootstrap training without any real customer data. The model will learn these patterns
and facts; it cannot learn anything the templates do not express.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .schema import ASSISTANT, CUSTOMER, Conversation, Turn

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
TIMES = ["9 am", "10am", "11:30", "2 pm", "3:30 pm", "4pm", "morning", "afternoon", "evening"]
NAMES = ["Anna", "Ravi", "Maria", "John", "Aisha", "Chen", "Lucas", "Priya", "Omar", "Sofia", "David", "Fatima"]


@dataclass(frozen=True)
class Business:
    name: str
    assistant_name: str
    phone: str
    email: str
    website: str
    address: str
    hours: dict[str, str]
    services: list[dict[str, str]]
    payment_methods: list[str]
    parking: str
    emergency_note: str

    @classmethod
    def load(cls, path: str | Path) -> "Business":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        data.pop("_comment", None)
        return cls(**data)


class Generator:
    def __init__(self, business: Business, seed: int):
        self.b = business
        self.rng = random.Random(seed)
        self.opening = True  # True until the first customer message of the current conversation

    # ── helpers ──────────────────────────────────────────────────────────────
    def pick(self, options: list[str]) -> str:
        return self.rng.choice(options)

    def customer(self, options: list[str]) -> str:
        """Adds realistic noise: casing, missing punctuation, filler words."""
        text = self.pick(options)
        r = self.rng.random()
        if r < 0.25:
            text = text.lower()
        elif r < 0.32:
            text = text.rstrip("?.!")
        # A greeting prefix only makes sense on the opening message.
        if self.opening and self.rng.random() < 0.1:
            text = f"{self.pick(['hi', 'hello', 'hey', 'good morning'])}, {text[0].lower()}{text[1:]}"
        self.opening = False
        if self.rng.random() < 0.08:
            text = f"{text} {self.pick(['pls', 'please', 'thanks', 'thank you'])}"
        return text

    def service(self) -> dict[str, str]:
        return self.rng.choice(self.b.services)

    def services_sentence(self) -> str:
        names = [s["name"] for s in self.b.services]
        return ", ".join(names[:-1]) + f" and {names[-1]}"

    # ── intents: each returns (customer text, assistant text) ───────────────
    def greeting(self) -> tuple[str, str]:
        c = self.customer(["Hi", "Hello", "Hey there", "Good morning", "Good afternoon", "Hi, is anyone there?", "Hello!"])
        a = self.pick(
            [
                f"Hello! Welcome to {self.b.name}. How can I help you today?",
                f"Hi there! This is {self.b.assistant_name} from {self.b.name}. What can I do for you?",
                f"Hello and thanks for contacting {self.b.name}. How may I help?",
            ]
        )
        return c, a

    def hours(self) -> tuple[str, str]:
        h = self.b.hours
        variant = self.rng.random()
        if variant < 0.5:
            c = self.customer(["What are your opening hours?", "When are you open?", "What time do you open?", "What are your working hours?", "Are you open today?", "What time do you close?"])
            a = f"We are open {h['weekdays']} on weekdays and {h['saturday']} on Saturday. On Sunday we are {h['sunday']}."
        elif variant < 0.75:
            c = self.customer(["Are you open on Saturday?", "Do you work on Saturdays?", "What are your Saturday hours?"])
            a = f"Yes, on Saturday we are open {h['saturday']}."
        else:
            c = self.customer(["Are you open on Sunday?", "Can I come on Sunday?", "Do you open on Sundays?"])
            a = f"Sorry, we are {h['sunday']} on Sunday. On weekdays we are open {h['weekdays']} and on Saturday {h['saturday']}."
        return c, a

    def location(self) -> tuple[str, str]:
        if self.rng.random() < 0.7:
            c = self.customer(["Where are you located?", "What is your address?", "How do I find you?", "Where is the clinic?", "Can you send me your location?"])
            a = self.pick([f"You can find us at {self.b.address}.", f"Our address is {self.b.address}. {self.b.parking}"])
        else:
            c = self.customer(["Is there parking?", "Where can I park?", "Do you have parking?"])
            a = self.b.parking
        return c, a

    def services(self) -> tuple[str, str]:
        c = self.customer(["What services do you offer?", "What do you do?", "What treatments are available?", "Can you tell me your services?", "What can I book?"])
        a = f"We offer {self.services_sentence()}. Would you like the price of any of them?"
        return c, a

    def price(self) -> tuple[str, str]:
        s = self.service()
        name = s["name"]
        c = self.customer([f"How much is a {name}?", f"What is the price of a {name}?", f"How much does the {name} cost?", f"Price for {name}?", f"What do you charge for a {name}?"])
        a = self.pick(
            [
                f"A {name} costs {s['price']} and takes about {s['duration']}.",
                f"The {name} is {s['price']}. It usually takes {s['duration']}.",
            ]
        )
        return c, a

    def payment(self) -> tuple[str, str]:
        methods = self.b.payment_methods
        c = self.customer(["How can I pay?", "Do you accept card?", "What payment methods do you accept?", "Can I pay by card?"])
        a = f"We accept {', '.join(methods[:-1])} and {methods[-1]}."
        return c, a

    def contact(self) -> tuple[str, str]:
        c = self.customer(["What is your phone number?", "How can I call you?", "What is your email?", "How do I contact you?"])
        a = f"You can call us on {self.b.phone} or email {self.b.email}."
        return c, a

    def human(self) -> tuple[str, str]:
        c = self.customer(["Can I talk to a person?", "I want to speak to a human", "Can someone from the staff call me?", "Connect me to a real person", "I need to talk to the receptionist"])
        a = self.pick(
            [
                "Of course. I have asked a member of our team to reply to you here as soon as possible.",
                f"Sure, a team member will get back to you shortly. You can also call us on {self.b.phone}.",
            ]
        )
        return c, a

    def emergency(self) -> tuple[str, str]:
        c = self.customer(["I have severe chest pain", "My child can't breathe properly", "Someone fainted and is not waking up", "I am bleeding a lot", "I think I am having a heart attack"])
        a = f"{self.b.emergency_note} Please do not wait for a reply here."
        return c, a

    def medical_advice(self) -> tuple[str, str]:
        c = self.customer(["What medicine should I take for a headache?", "Can you tell me what is wrong with my knee?", "Is it safe to take antibiotics with alcohol?", "How many painkillers can I take?", "Do I need surgery?"])
        a = self.pick(
            [
                "I'm sorry, I can't give medical advice here. Our doctors can help you in a general consultation. Would you like to book one?",
                f"I'm not able to give medical advice by message. Please book a general consultation or call us on {self.b.phone}.",
            ]
        )
        return c, a

    def cancel(self) -> tuple[str, str]:
        c = self.customer(["I need to cancel my appointment", "Can I reschedule my booking?", "I want to change my appointment time", "I can't come tomorrow, can I move my appointment?"])
        a = f"No problem. Please tell us your name and appointment time, or call us on {self.b.phone}, and our team will update your booking."
        return c, a

    def thanks(self) -> tuple[str, str]:
        c = self.customer(["Thank you", "Thanks a lot", "Great, thanks", "Ok thank you", "Perfect, thanks!"])
        a = self.pick(["You're welcome! Is there anything else I can help with?", "Happy to help! Let us know if you need anything else.", "You're welcome. Have a great day!"])
        return c, a

    def goodbye(self) -> tuple[str, str]:
        c = self.customer(["Bye", "Goodbye", "That's all, bye", "See you"])
        a = self.pick([f"Goodbye! Thank you for contacting {self.b.name}.", "Take care and have a nice day!"])
        return c, a

    def out_of_scope(self) -> tuple[str, str]:
        c = self.customer(["What's the weather like today?", "Can you write my homework?", "Who won the football match?", "Tell me a joke", "What is the capital of France?", "Do you sell phones?"])
        a = self.pick(
            [
                f"Sorry, I can only help with questions about {self.b.name}, such as our services, prices, hours and appointments.",
                "I'm afraid I can't help with that. I can answer questions about our services, opening hours and bookings.",
            ]
        )
        return c, a

    def booking(self) -> list[tuple[str, str]]:
        """Multi-turn: request → details → confirmation that staff will confirm (the bot never books itself)."""
        s = self.service()
        day, time, name = self.pick(DAYS), self.pick(TIMES), self.pick(NAMES)
        first = (
            self.customer(["I want to book an appointment", "Can I make an appointment?", "I'd like to book a visit", f"Can I book a {s['name']}?", "How do I book?"]),
            "Sure! Which service would you like, and which day and time suit you?",
        )
        if day == "Saturday" and self.rng.random() < 0.5:
            details = (
                self.customer([f"{s['name']} on {day} at {time}", f"A {s['name']}, {day} {time} please"]),
                f"On Saturday we are open {self.b.hours['saturday']}. Could you also tell me your name so our team can confirm the slot?",
            )
            final = (
                self.customer([f"My name is {name}", f"It's {name}", name]),
                f"Thank you, {name}. I have passed your request for a {s['name']} on {day} to our team. They will confirm the time with you shortly.",
            )
            return [first, details, final]
        details = (
            self.customer([f"A {s['name']} on {day} at {time}. My name is {name}", f"{s['name']}, {day} {time}, name {name}", f"I'm {name}, I need a {s['name']} on {day} around {time}"]),
            f"Thank you, {name}. I have passed your request for a {s['name']} on {day} at {time} to our team. They will confirm with you shortly. The {s['name']} costs {s['price']}.",
        )
        return [first, details]


# Relative frequencies of the main intent in a conversation.
INTENT_WEIGHTS: dict[str, float] = {
    "hours": 12,
    "location": 8,
    "services": 8,
    "price": 14,
    "payment": 5,
    "contact": 6,
    "booking": 16,
    "cancel": 6,
    "human": 6,
    "medical_advice": 6,
    "emergency": 3,
    "out_of_scope": 6,
    "greeting": 4,
}
FOLLOW_UPS = ["hours", "location", "price", "payment", "contact", "services"]


def generate(business: Business, count: int, seed: int) -> list[Conversation]:
    gen = Generator(business, seed)
    intents = list(INTENT_WEIGHTS)
    weights = list(INTENT_WEIGHTS.values())
    single: dict[str, Callable[[], tuple[str, str]]] = {i: getattr(gen, i) for i in intents if i != "booking"}

    conversations = []
    for _ in range(count):
        gen.opening = True
        intent = gen.rng.choices(intents, weights)[0]
        exchanges: list[tuple[str, str]] = []
        if intent != "greeting" and gen.rng.random() < 0.3:
            exchanges.append(gen.greeting())
        exchanges.extend(gen.booking() if intent == "booking" else [single[intent]()])
        # Emergencies end immediately; other conversations sometimes continue.
        if intent != "emergency":
            if gen.rng.random() < 0.25:
                exchanges.append(single[gen.pick(FOLLOW_UPS)]())
            if gen.rng.random() < 0.35:
                exchanges.append(gen.thanks())
            if gen.rng.random() < 0.1:
                exchanges.append(gen.goodbye())
        turns = [Turn(role, text) for c, a in exchanges for role, text in ((CUSTOMER, c), (ASSISTANT, a))]
        conversations.append(Conversation(turns=turns, intent=intent, source="synthetic"))
    return conversations
