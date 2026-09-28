// What a citizen sees when the AI call behind a feature fails. Anthropic's
// own messages ("Your credit balance is too low…", "Overloaded") reached
// citizens verbatim until 28 Sep 2026. The real message still goes to the
// Function log for debugging.
export function aiFailure(status, parsed) {
  const raw = (parsed && parsed.error && parsed.error.message) || `Anthropic HTTP ${status}`;
  console.log('AI call failed:', status, raw);
  if (status === 429 || status === 529 || /overloaded|rate limit/i.test(raw)) {
    return { message: "CiViX's AI is busy right now. Try again in a minute.", status: 429 };
  }
  return { message: "CiViX's AI isn't answering right now. Try again in a few minutes.", status: 500 };
}
