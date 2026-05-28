import re
import sys

# ─────────────────────────────────────────────
# WHAT IS THIS FILE?
#
# This tool shows you how an LLM breaks your
# text into "tokens" before it reads it.
#
# Example:
#   You type  →  "Hello world"
#   LLM sees  →  ["Hello", " world"]  (2 tokens)
#
# Run it like this:
#   python tokenizer_explained.py "your text here"
# ─────────────────────────────────────────────


# ─────────────────────────────────────────────
# TERMINAL COLORS
#
# These are special codes your terminal understands.
# They change the background color of text.
# We use them to paint each token a different color
# so you can visually see where one token ends
# and the next one begins.
# ─────────────────────────────────────────────

COLOR_LIST = [
    "\033[48;5;117m\033[30m",   # light blue background
    "\033[48;5;120m\033[30m",   # light green background
    "\033[48;5;216m\033[30m",   # light orange background
    "\033[48;5;183m\033[30m",   # light purple background
    "\033[48;5;228m\033[30m",   # light yellow background
    "\033[48;5;210m\033[30m",   # light red background
    "\033[48;5;159m\033[30m",   # light cyan background
]

COLOR_RESET = "\033[0m"   # turn off color, go back to normal
BOLD        = "\033[1m"   # make text bold
DIM         = "\033[2m"   # make text look faded


# ─────────────────────────────────────────────
# STEP 1 — SPLIT TEXT INTO ROUGH CHUNKS
#
# Before we do any real tokenizing, we split the
# input into rough pieces using a regex pattern.
#
# Why? Because we want to handle things like:
#   - "isn't"  →  ["isn", "'t"]   contractions stay together
#   - "hello!" →  ["hello", "!"]  punctuation is separate
#   - " world" →  [" world"]      space sticks to the word after it
#
# This is the exact same regex GPT-2 uses.
# ─────────────────────────────────────────────

SPLIT_PATTERN = re.compile(
    r"'s|'t|'re|'ve|'m|'ll|'d"   # English contractions ('t, 're, 'll, etc.)
    r"| ?\w+"                      # optional space + letters/numbers  e.g. " hello", "world"
    r"| ?[^\s\w]+"                 # optional space + punctuation      e.g. "!", "..."
    r"|\s+(?!\S)"                  # trailing whitespace at end of line
    r"|\s+",                       # any other whitespace (tabs, newlines)
    re.UNICODE                     # support non-English characters too
)


# ─────────────────────────────────────────────
# STEP 2 — BUILD A BYTE MAP
#
# LLMs don't work with letters directly.
# They work with BYTES (numbers 0–255).
#
# The problem: some bytes have no readable symbol.
# For example, byte 32 is a space — hard to display.
#
# The fix: we map every byte to a unique readable
# unicode character. This way EVERYTHING is printable.
#
# The most noticeable mapping:
#   space (byte 32)  →  Ġ
#
# That's why tokens look like "Ġhello" instead of " hello".
# The Ġ just means "this token starts with a space".
# ─────────────────────────────────────────────

def build_byte_map():

    # start with bytes that already look fine as characters
    # these are standard printable ASCII and some latin characters
    nice_bytes = (
        list(range(ord('!'), ord('~') + 1)) +    # ! " # $ ... ~ (bytes 33 to 126)
        list(range(ord('¡'), ord('¬') + 1)) +    # ¡ ¢ £ ... ¬  (bytes 161 to 172)
        list(range(ord('®'), ord('ÿ') + 1))      # ® ¯ ° ... ÿ  (bytes 174 to 255)
    )

    # the mapped characters start the same as the bytes
    mapped_chars = list(nice_bytes)

    # now handle the bytes that were NOT in the nice list above
    # (space=32, tab=9, newline=10, null=0, etc.)
    # we give each one a unique character above 256 so it doesn't clash
    next_available_char = 256
    for byte_value in range(256):
        if byte_value not in nice_bytes:
            nice_bytes.append(byte_value)
            mapped_chars.append(next_available_char)
            next_available_char += 1

    # build the final lookup table
    # example entries:  32 → 'Ġ',   65 → 'A',   10 → 'Ċ'
    byte_to_char = {}
    for byte_val, char_code in zip(nice_bytes, mapped_chars):
        byte_to_char[byte_val] = chr(char_code)

    return byte_to_char

# build the map once and reuse it
BYTE_MAP = build_byte_map()


# ─────────────────────────────────────────────
# HELPER — convert one word into byte symbols
#
# Takes a string like " the"
# Returns a list like ['Ġ', 't', 'h', 'e']
#
# How:
#   1. encode the string to raw bytes using UTF-8
#   2. look up each byte in BYTE_MAP
# ─────────────────────────────────────────────

def word_to_byte_symbols(word):
    raw_bytes = word.encode('utf-8')   # e.g. " the" → b'\x20\x74\x68\x65'
    symbols = []
    for byte in raw_bytes:
        symbols.append(BYTE_MAP[byte]) # look up each byte in our map
    return symbols


# ─────────────────────────────────────────────
# STEP 3 — BPE MERGE RULES
#
# BPE = Byte Pair Encoding
#
# The idea is simple:
#   Start with individual characters.
#   Find the most common pair.
#   Merge them into one token.
#   Repeat.
#
# Example:
#   ['t','h','e'] → apply ('t','h') merge → ['th','e']
#   ['th','e']    → apply ('th','e') merge → ['the']
#   "the" is now a single token!
#
# Real GPT-2 has 50,000 such merge rules learned from
# training on billions of words. We use a small sample
# just to show how it works.
#
# The ORDER of this list matters — earlier merges run
# first, and later merges can use their results.
# ─────────────────────────────────────────────

MERGE_RULES = [
    # space + single letter  (remember: space = Ġ in our byte map)
    # these are first because a space followed by a letter is very common
    ('Ġ', 't'), ('Ġ', 'a'), ('Ġ', 's'), ('Ġ', 'i'), ('Ġ', 'o'),
    ('Ġ', 'w'), ('Ġ', 'b'), ('Ġ', 'h'), ('Ġ', 'f'), ('Ġ', 'c'),
    ('Ġ', 'n'), ('Ġ', 'e'), ('Ġ', 'p'), ('Ġ', 'l'), ('Ġ', 'm'),
    ('Ġ', 'g'), ('Ġ', 'r'), ('Ġ', 'd'), ('Ġ', 'u'), ('Ġ', 'v'),

    # common letter pairs in English
    ('t', 'h'),        # th
    ('th', 'e'),       # the  ← uses the result of the line above
    ('i', 'n'),        # in
    ('e', 'r'),        # er
    ('a', 'n'),        # an
    ('r', 'e'),        # re
    ('o', 'n'),        # on
    ('Ġt', 'he'),      # Ġthe  (the whole word "the" as one token)
    ('Ġt', 'o'),       # Ġto
    ('Ġa', 'nd'),      # Ġand
    ('Ġi', 's'),       # Ġis
    ('Ġi', 'n'),       # Ġin
    ('o', 'r'),        # or
    ('a', 't'),        # at
    ('e', 'n'),        # en
    ('i', 't'),        # it
    ('e', 's'),        # es
    ('Ġw', 'ith'),     # Ġwith
    ('a', 'l'),        # al
    ('Ġo', 'f'),       # Ġof
    ('Ġf', 'or'),      # Ġfor
    ('o', 'f'),        # of
    ('Ġh', 'as'),      # Ġhas
    ('t', 'i'),        # ti
    ('Ġb', 'e'),       # Ġbe
    ('e', 'd'),        # ed
    ('n', 't'),        # nt
    ('Ġ', 'T'), ('Ġ', 'I'), ('Ġ', 'A'),
    ('a', 'r'), ('Ġ', 'W'), ('i', 'c'), ('i', 'n'), ('l', 'l'),
    ('Ġn', 'ot'), ('Ġs', 'o'), ('a', 's'), ('t', 's'), ('i', 'o'),
    ('Ġw', 'as'), ('c', 'h'), ('Ġy', 'ou'), ('e', 'c'), ('e', 'l'),
    ('l', 'e'), ('s', 't'), ('Ġ', 'C'), ('a', 'c'), ('Ġth', 'at'),
    ('p', 'r'), ('o', 't'), ('u', 'r'), ('Ġ', 'M'), ('Ġ', 'S'),
    ('i', 'l'), ('k', 'e'), ('Ġ', 'H'), ('r', 'o'), ('Ġ', 'P'),
    ('a', 'g'), ('Ġ', 'N'), ('Ġ', 'L'), ('Ġ', 'D'), ('o', 'w'),
    ('Ġ', 'R'), ('Ġ', 'F'), ('Ġ', 'G'), ('Ġ', 'E'), ('Ġ', 'O'),
    ('Ġ', 'Y'), ('Ġ', 'B'), ('Ġ', 'J'), ('Ġ', 'K'),
    ('i', 'ng'),       # ing — very common English suffix
    ('Ġs', 't'), ('Ġs', 'e'), ('Ġt', 'r'), ('Ġc', 'on'), ('Ġh', 'e'),
    ('m', 'o'), ('l', 'y'), ('o', 'l'),
    ('Ġ', '1'), ('Ġ', '2'), ('Ġ', '3'),   # space + digit
    ('1', '0'), ('0', '0'),                # number pairs like 10, 100
]


# ─────────────────────────────────────────────
# HELPER — apply one merge rule to a word
#
# Takes a list of symbols and one merge rule (a, b).
# Scans left to right. Wherever it sees 'a' followed
# by 'b', it replaces both with 'ab'.
#
# Example:
#   apply_one_merge(['t','h','e'], ('t','h'))
#   → ['th', 'e']
# ─────────────────────────────────────────────

def apply_one_merge(symbols, merge_pair):
    left_symbol  = merge_pair[0]   # e.g. 't'
    right_symbol = merge_pair[1]   # e.g. 'h'

    result = []
    i = 0
    while i < len(symbols):
        # check if current symbol matches left side of merge
        # and the next symbol matches the right side
        is_last_symbol = (i == len(symbols) - 1)
        if not is_last_symbol and symbols[i] == left_symbol and symbols[i+1] == right_symbol:
            # merge! combine both into one
            result.append(left_symbol + right_symbol)
            i += 2   # jump over both symbols since we just merged them
        else:
            # no match — keep the symbol as it is
            result.append(symbols[i])
            i += 1

    return result


# ─────────────────────────────────────────────
# MAIN FUNCTION — tokenize the full input text
# ─────────────────────────────────────────────

def tokenize(text):

    # ── Step 1: rough split ───────────────────
    # e.g. "Hello, isn't it?" → ["Hello", ",", " isn", "'t", " it", "?"]
    rough_chunks = SPLIT_PATTERN.findall(text)

    # ── Step 2 + 3: encode and merge each chunk
    all_tokens = []

    for chunk in rough_chunks:

        # convert chunk to byte symbols
        # e.g. " the" → ['Ġ', 't', 'h', 'e']
        symbols = word_to_byte_symbols(chunk)

        # if only one symbol, nothing to merge — just add it directly
        if len(symbols) == 1:
            all_tokens.append(symbols[0])
            continue

        # apply every merge rule one at a time, in order
        for merge_rule in MERGE_RULES:
            symbols = apply_one_merge(symbols, merge_rule)
            # after each merge, symbols list gets shorter (or stays same)
            # e.g. ['t','h','e'] → ['th','e'] → ['the']

        # whatever symbols remain are the final tokens for this chunk
        all_tokens.extend(symbols)

    return all_tokens


# ─────────────────────────────────────────────
# DISPLAY — print results in a nice format
# ─────────────────────────────────────────────

def show_results(text):

    tokens = tokenize(text)

    print(f"\n{BOLD}Your input:{COLOR_RESET}  {repr(text)}")
    print(f"{DIM}(using GPT-2 style byte-level BPE — approximate){COLOR_RESET}\n")

    # ── Colored view ──────────────────────────
    # paint each token a different color so boundaries are visible
    print(f"{BOLD}Tokens highlighted:{COLOR_RESET}  (Ġ means the token starts with a space)\n")

    colored_line = ""
    for index, token in enumerate(tokens):
        # pick a color — cycle through 7 colors using modulo (remainder)
        # index 0 → color 0, index 7 → color 0 again, index 8 → color 1, etc.
        color = COLOR_LIST[index % len(COLOR_LIST)]

        # make the space symbol visible as a dot
        # make newlines visible as ↵ so they don't break the line
        display_text = token.replace('Ġ', 'Ġ').replace('\n', '↵')

        colored_line += color + display_text + COLOR_RESET

    print("  " + colored_line)
    print()

    # ── Token table ───────────────────────────
    print(f"{BOLD}Token breakdown table:{COLOR_RESET}\n")
    print(f"  {'No.':<6} {'Token':<22} {'Type'}")
    print("  " + "─" * 44)

    for index, token in enumerate(tokens):

        # make it human readable in the table
        readable = token.replace('Ġ', '[space]')

        # figure out what kind of token this is
        if token.startswith('Ġ'):
            token_type = "word (with leading space)"
        elif len(token) == 1 and not token.isalnum():
            token_type = "punctuation"
        elif token.isdigit():
            token_type = "number"
        elif len(token) > 1:
            token_type = "sub-word piece"
        else:
            token_type = "single letter"

        print(f"  {index+1:<6} {readable:<22} {DIM}{token_type}{COLOR_RESET}")

    print("  " + "─" * 44)

    # ── Summary stats ─────────────────────────
    total_tokens = len(tokens)
    total_chars  = len(text)
    avg          = total_chars / total_tokens

    print(f"\n  {BOLD}Total tokens:{COLOR_RESET}  {total_tokens}")
    print(f"  {BOLD}Total chars: {COLOR_RESET}  {total_chars}")
    print(f"  {BOLD}Chars/token: {COLOR_RESET}  {avg:.1f} on average")
    print()
    print(f"  {DIM}(Real GPT-4 averages ~3–4 chars per token on English text.")
    print(f"  Lower number here = smaller merge table = more splits){COLOR_RESET}")
    print()


# ─────────────────────────────────────────────
# INTERACTIVE MODE
#
# When you run the file with no arguments,
# it drops into a loop asking you to type things.
# Type 'quit' to exit.
# ─────────────────────────────────────────────

def run_interactive():
    print(f"\n{BOLD}Token Visualizer{COLOR_RESET}")
    print("See how LLMs break your text into tokens.")
    print("Type anything and press Enter. Type 'quit' to stop.\n")

    while True:
        try:
            user_input = input(f"{BOLD}>{COLOR_RESET} ")   # wait for user to type
            user_input = user_input.strip()                  # remove extra spaces

            if user_input == "":
                continue   # they pressed Enter with nothing — ask again

            if user_input.lower() in ("quit", "exit", "q"):
                print("bye!")
                break      # exit the loop

            show_results(user_input)

        except KeyboardInterrupt:
            # user pressed Ctrl+C — exit cleanly
            print("\nbye!")
            break


# ─────────────────────────────────────────────
# ENTRY POINT
#
# Python runs this block when you execute the file directly.
#
# Two modes:
#   With argument  →  python tokenizer_explained.py "hello world"
#   No argument    →  python tokenizer_explained.py   (interactive)
# ─────────────────────────────────────────────

if __name__ == "__main__":

    # sys.argv is a list of everything typed in the terminal
    # sys.argv[0] = "tokenizer_explained.py"  (the filename)
    # sys.argv[1] = "hello"                   (first argument, if given)

    arguments_given = len(sys.argv) > 1

    if arguments_given:
        # join all arguments into one string in case they typed multiple words
        input_text = " ".join(sys.argv[1:])
        show_results(input_text)
    else:
        run_interactive()