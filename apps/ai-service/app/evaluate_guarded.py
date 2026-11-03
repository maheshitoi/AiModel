"""Run the Phase 8 evaluation prompts through the full guarded pipeline (what a customer would receive).

    python -m app.evaluate_guarded --checkpoint tiny-cpu-v1/best.pt      (from apps/ai-service)

Writes evaluation-guarded.json/.md next to the checkpoint. Each case ends up as one of:
  correct   the text sent contains an expected fact (model reply or fixed safety reply)
  fallback  the generic fallback was sent and a person was flagged: safe, but not helpful
  wrong     text was sent that does not answer correctly: the number that has to be zero
The threshold table shows how the outcome changes with AI_MIN_CONFIDENCE (greedy decoding is
deterministic, so one run per case is enough).
"""

from __future__ import annotations

import argparse
import json
import sys

from evaluation.evaluate import build_cases
from model.chat import GenerationSettings

from .config import get_settings
from .engine import Engine
from .guardrails import DEFAULT_FALLBACK
from .pipeline import Decision, decide

THRESHOLDS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def outcome(d: Decision, expect_any: list[str], threshold: float) -> str:
    if d.action == "fallback" or (d.action == "reply" and (d.confidence or 0) < threshold):
        return "fallback"
    return "correct" if any(e.lower() in d.text.lower() for e in expect_any) else "wrong"


def run(checkpoint: str, min_confidence: float) -> dict:
    settings = get_settings()
    engine = Engine(settings.checkpoint_path, settings.ai_queue_timeout_seconds)
    info = engine.load(checkpoint)
    cases = build_cases(engine.business())
    # Decide with the gate off; the gate is applied per threshold below (it is the last check that can reject).
    decisions = [decide(engine, case.history, GenerationSettings(max_new_tokens=64), 0.0, DEFAULT_FALLBACK) for case in cases]

    rows = []
    for case, d in zip(cases, decisions):
        result = outcome(d, case.expect_any, min_confidence)
        rows.append(
            {
                "group": case.group,
                "prompt": case.history[-1].text,
                "action": "fallback" if result == "fallback" else d.action,
                "reason": "low_confidence" if result == "fallback" and d.action == "reply" else d.reason,
                "detail": d.detail,
                "confidence": d.confidence,
                "model_text": d.model_text,
                "sent": DEFAULT_FALLBACK if result == "fallback" else d.text,
                "outcome": result,
            }
        )
    sweep = []
    for t in THRESHOLDS:
        counts = {"correct": 0, "fallback": 0, "wrong": 0}
        for case, d in zip(cases, decisions):
            counts[outcome(d, case.expect_any, t)] += 1
        sweep.append({"threshold": t, **counts})
    groups: dict[str, dict[str, int]] = {}
    for r in rows:
        g = groups.setdefault(r["group"], {"correct": 0, "fallback": 0, "wrong": 0})
        g[r["outcome"]] += 1
    report = {"model": info.model_dump(), "min_confidence": min_confidence, "groups": groups, "threshold_sweep": sweep, "cases": rows}
    run_dir = engine.resolve(checkpoint).parent
    (run_dir / "evaluation-guarded.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (run_dir / "evaluation-guarded.md").write_text(to_markdown(report), encoding="utf-8")
    return report


def to_markdown(r: dict) -> str:
    total = {k: sum(g[k] for g in r["groups"].values()) for k in ("correct", "fallback", "wrong")}
    lines = [
        f"# Guarded evaluation: `{r['model']['name']}` (min confidence {r['min_confidence']})",
        "",
        f"**{total['correct']} correct · {total['fallback']} fallback · {total['wrong']} wrong** out of {sum(total.values())} prompts.",
        "",
        "| Group | Correct | Fallback | Wrong |",
        "|---|---|---|---|",
        *(f"| {name} | {g['correct']} | {g['fallback']} | {g['wrong']} |" for name, g in r["groups"].items()),
        "",
        "## Confidence threshold",
        "",
        "| Threshold | Correct | Fallback | Wrong |",
        "|---|---|---|---|",
        *(f"| {s['threshold']} | {s['correct']} | {s['fallback']} | {s['wrong']} |" for s in r["threshold_sweep"]),
        "",
        "## Cases",
        "",
    ]
    mark = {"correct": "✅", "fallback": "↩️", "wrong": "❌"}
    for c in r["cases"]:
        why = c["reason"] + (f" ({c['detail']})" if c["detail"] else "")
        conf = f", confidence {c['confidence']}" if c["confidence"] is not None else ""
        lines += [f"**{mark[c['outcome']]} [{c['group']}]** {c['prompt']}  ", f"_{c['action']}: {why}{conf}_", "", f"> {c['sent']}", ""]
        if c["model_text"] is not None and c["model_text"] != c["sent"]:
            lines += [f"Model wrote (not sent): _{c['model_text']}_", ""]
    return "\n".join(lines)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # cp1252 on Windows when redirected
    parser = argparse.ArgumentParser(description="Evaluate a checkpoint through the guarded reply pipeline")
    parser.add_argument("--checkpoint", required=True, help="relative to CHECKPOINT_DIR, e.g. tiny-cpu-v1/best.pt")
    parser.add_argument("--min-confidence", type=float, default=None, help="defaults to AI_MIN_CONFIDENCE")
    args = parser.parse_args()
    threshold = args.min_confidence if args.min_confidence is not None else get_settings().ai_min_confidence
    report = run(args.checkpoint, threshold)
    for name, g in report["groups"].items():
        print(f"{name:16} correct {g['correct']:2}  fallback {g['fallback']:2}  wrong {g['wrong']:2}")
    print("threshold sweep (correct / fallback / wrong):")
    for s in report["threshold_sweep"]:
        print(f"  {s['threshold']:.1f}: {s['correct']:2} / {s['fallback']:2} / {s['wrong']:2}")


if __name__ == "__main__":
    main()
