/** Human-readable labels for the reasons the backend flags a conversation or rejects an AI reply. */
export const REASON_LABELS: Record<string, string> = {
  emergency: "Emergency",
  self_harm: "Self-harm risk",
  medical_advice: "Medical question",
  human_request: "Asked for a person",
  low_confidence: "AI was unsure",
  ungrounded: "AI reply had unsupported details",
  action_claim: "AI claimed an action",
  medical_content: "AI mentioned a dosage",
  incomplete: "AI reply incomplete",
  no_reply: "AI gave no reply",
  ai_unavailable: "AI unavailable",
  delivery_failed: "Delivery failed",
  model_reply: "Model reply",
};

export const reasonLabel = (reason: string | null) => (reason ? (REASON_LABELS[reason] ?? reason.replaceAll("_", " ")) : "Needs attention");

/** Emergencies and self-harm need a person now; everything else can wait a little. */
export const isUrgent = (reason: string | null) => reason === "emergency" || reason === "self_harm";

export const customerLabel = (c: { customerName: string | null; customerWaId: string }) => c.customerName ?? `+${c.customerWaId}`;
