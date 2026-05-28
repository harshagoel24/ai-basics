# Token Visualizer

A mini CLI tool that shows you how LLMs break your text into tokens.
Built to go alongside a LinkedIn series on learning AI as a software engineer.

---

## What it does

- Splits your input using a GPT-2 style byte-level BPE algorithm
- Shows each token painted in a different color so you can see exactly where one ends and the next begins
- Prints a table with the token number, value, and type (word, sub-word, punctuation, etc.)
- Shows total token count, char count, and average chars per token
- Runs as a one-shot CLI command or an interactive loop

---

## How to run

### Python

```bash
# One-shot
python tokenizer.py "Hello, I am learning about LLMs!"

# Interactive loop
python tokenizer.py
```

No dependencies. Pure Python 3, stdlib only.

---

### Node.js

```bash
# One-shot
node tokenizer.js "Hello, I am learning about LLMs!"

# Interactive loop
node tokenizer.js
```

No dependencies. Pure Node.js, no npm install needed.

---

## Example output

```
Your input:  "isn't it wild how tokens work?"
(using GPT-2 style byte-level BPE — approximate)

Tokens highlighted:  (Ġ means the token starts with a space)

  isn'tĠitĠwildĠhowĠtokensĠwork?

Token breakdown table:

  No.   Token                 Type
  ────────────────────────────────────────────
  1     is                    sub-word piece
  2     n                     single letter
  3     't                    punctuation
  4     [space]it             word (with leading space)
  5     [space]w              word (with leading space)
  6     il                    sub-word piece
  7     d                     single letter
  8     [space]how            word (with leading space)
  ...
  ────────────────────────────────────────────

  Total tokens:  17
  Total chars:   30
  Chars/token:   1.8 on average

  (Real GPT-4 averages ~3–4 chars per token on English text.
  Lower number here = smaller merge table = more splits)
```

---

## How it actually works

LLMs don't read character by character or word by word.
They use **Byte Pair Encoding (BPE)** — a compression algorithm that merges the most
frequent pairs of characters repeatedly until it hits a target vocabulary size.

The process has three steps:

**Step 1 — Pre-tokenise**
Split the text using a regex that handles contractions, spaces, and punctuation
as separate units. This is the exact same regex GPT-2 uses.
For example: `"isn't it?"` → `["isn", "'t", " it", "?"]`

**Step 2 — Byte-level encode**
Convert every character to a byte representation so every possible input is
representable without an `[UNK]` (unknown) token.
The most visible effect: a space becomes `Ġ`, so `" hello"` becomes `['Ġ','h','e','l','l','o']`.

**Step 3 — Apply merge rules**
Greedily merge common character pairs using a learned merge table, in order.
Common subwords like `ing`, `the`, `tion` get merged into single tokens.
Rare or unknown words stay as individual bytes.

```
['t','h','e']  →  apply ('t','h')  →  ['th','e']
['th','e']     →  apply ('th','e') →  ['the']
```

This tool uses an approximate merge table (a small sample of real GPT-2 merges).
Real models like GPT-4 or Claude use 50k–100k vocab merge tables trained on
billions of tokens — so their splits will be more aggressive on common words.

---

## Why this matters when building with LLMs

- **Cost** — APIs charge per token, not per character or word
- **Context window** — limits are in tokens, not words (GPT-4: 128k, Claude: 200k)
- **Prompt efficiency** — knowing how text tokenises helps you write tighter prompts
- **Weird model behaviour** — unexpected splits explain why models sometimes
  struggle with specific words, names, or code
