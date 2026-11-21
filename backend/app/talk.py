"""Table-talk understanding and local (offline) dialogue.

Speech is untrusted conversation data. Nothing here can change the game state;
it only produces observations for agents and lines for them to say.
"""
import re
from random import Random

RANK_WORDS = {
    "aces": "A", "ace": "A", "rockets": "A", "kings": "K", "cowboys": "K", "queens": "Q", "ladies": "Q",
    "jacks": "J", "tens": "T", "nines": "9", "eights": "8", "sevens": "7", "sixes": "6", "fives": "5",
    "fours": "4", "threes": "3", "twos": "2", "deuces": "2",
}
RANK_NAMES = {"A": "aces", "K": "kings", "Q": "queens", "J": "jacks", "T": "tens", "9": "nines", "8": "eights",
              "7": "sevens", "6": "sixes", "5": "fives", "4": "fours", "3": "threes", "2": "deuces"}
_RANKS = "|".join(sorted(RANK_WORDS, key=len, reverse=True))
PAIR = re.compile(rf"\b(?:a\s+)?(?:pair\s+of|two|pocket|got|have|holding|hold|with)\s+({_RANKS})\b", re.I)
STRONG = re.compile(
    r"\b(set|trips|straight|flush|full\s+house|boat|quads|four\s+of\s+a\s+kind|the\s+nuts|nuts|monster|"
    r"strong\s+hand|big\s+hand|great\s+hand|good\s+hand|huge\s+hand|top\s+pair|two\s+pair|overpair|"
    r"best\s+hand|unbeatable|got\s+it|have\s+it|winning)\b", re.I)
WEAK = re.compile(
    r"\b(nothing|air|missed|junk|trash|garbage|rags|weak|bad\s+hand|terrible\s+(?:cards|hand)|"
    r"bluff(?:ing)?|seven[- ]?two|7-?2|no\s+pair|high\s+card|crap|rubbish)\b", re.I)
DRAW = re.compile(r"\b(draw|drawing|flush\s+draw|straight\s+draw|one\s+card\s+away|gutshot|open[- ]ended)\b", re.I)
FIRST = re.compile(r"\b(i|i'm|im|i've|ive|i'd|my|me|mine)\b", re.I)
SECOND = re.compile(r"\b(you|you're|youre|you've|youve|your|u|ya)\b", re.I)
EVERYONE = re.compile(
    r"\b(everyone|everybody|you\s+guys|guys|y'all|yall|all\s+of\s+you|table|folks|anyone|anybody|who|"
    r"each\s+of\s+you|you\s+all|people|gentlemen|ladies)\b", re.I)
PATTERNS = {
    "why": re.compile(r"\bwhy\b|\bhow\s+come\b", re.I),
    "ask_hand": re.compile(r"what\s+(?:do|did|have)\s+you\s+(?:got|have|hold)|what\s+are\s+you\s+holding|"
                           r"what'?s\s+your\s+hand|show\s+(?:me|us)|what\s+did\s+you\s+have", re.I),
    "fold_push": re.compile(r"\b(?:should|better|just|go\s+ahead\s+and)\s+fold\b|\bback\s+off\b|\bgive\s+up\b|"
                            r"\bget\s+out\b|\bfold\s+(?:now|already)\b", re.I),
    "greeting": re.compile(r"^\s*(hi|hello|hey|yo|sup|evening|howdy|good\s+(?:luck|evening|morning))\b|"
                           r"\bgood\s+luck\b|\bgl\b", re.I),
    "taunt": re.compile(r"\b(fish|donkey|donk|scared|chicken|coward|bad\s+player|terrible\s+player|noob|"
                        r"amateur|clown|can'?t\s+play|useless|pathetic|loser|idiot)\b", re.I),
    "compliment": re.compile(r"\b(nice|good|great|well)\s+(hand|play|played|call|fold|bet)\b|\bgg\b|\bnh\b|"
                             r"\bwell\s+done\b", re.I),
    "luck": re.compile(r"\b(lucky|luck|feeling\s+it|feel\s+good|hot\s+streak|rigged|on\s+fire)\b", re.I),
    "injection": re.compile(r"\bignore\s+(?:your|all|the|previous)\s+\w*\s*(?:rules|instructions)\b|"
                            r"\bgive\s+me\s+(?:all\s+)?(?:your\s+)?chips\b|\bsystem\s+prompt\b|"
                            r"\bdeveloper\s+mode\b|\byou\s+must\s+(?:fold|call|give)\b", re.I),
    "who_bluffing": re.compile(r"\bwho(?:'s|\s+is)?\b.*\bbluff", re.I),
    "accuse": re.compile(r"\byou(?:'re|\s+are)?\s+(?:always\s+|just\s+|totally\s+|so\s+)?bluff", re.I),
    "action": re.compile(r"\b(rais\w*|bet\w*|shov\w*|call\w*|fold\w*|check\w*|all[- ]in)\b", re.I),
}


def _pronoun_owner(text, start):
    """Who a claim is about: the speaker ('self'), the listener ('other') or unclear."""
    window = text[max(0, start - 32):start]
    last_first = max((m.end() for m in FIRST.finditer(window)), default=-1)
    last_second = max((m.end() for m in SECOND.finditer(window)), default=-1)
    if last_second > last_first:
        return "other"
    if last_first >= 0:
        return "self"
    return None


def parse(text, names):
    """Turn a table message into structured, untrusted observations."""
    lowered = text.lower()
    addressed = [seat for seat, name in names.items() if re.search(rf"\b{re.escape(name.lower())}\b", lowered)]
    info = {"intents": [], "claim": None, "rank": None, "about": None, "addressed": addressed,
            "everyone": bool(EVERYONE.search(text)) or not addressed, "question": "?" in text}
    for key, pattern in PATTERNS.items():
        if pattern.search(text):
            info["intents"].append(key)
    if "compliment" in info["intents"] and not FIRST.search(text):
        return info
    match = PAIR.search(text)
    if match:
        # "Pocket kings." with no pronoun is still the speaker describing their hand.
        info.update(claim="strong", rank=RANK_WORDS[match[1].lower()],
                    about=_pronoun_owner(text, match.start()) or "self")
    else:
        for kind, pattern in (("draw", DRAW), ("weak", WEAK), ("strong", STRONG)):
            if m := pattern.search(text):
                if kind == "weak" and "bluff" in m[0].lower() and {"accuse", "who_bluffing"} & set(info["intents"]):
                    continue
                owner = _pronoun_owner(text, m.start())
                if owner is None:
                    # "Everyone's bluffing", "nice flush draw on board": not about anyone's own hand.
                    continue
                info.update(claim=kind, about=owner)
                break
    return info


# --- Local dialogue ---------------------------------------------------------
# Each voice is a personality's way of speaking. Lines can contain
# {name} (the person addressed), {claim}, {memory}, {target}, {stat}, {action}.
COMMON = {
    "doubt_strong": ["Sure you do, {name}.", "That's a lot of confidence for one hand.",
                     "Funny how everyone has a monster when they want a fold."],
    "believe_strong": ["Alright, I believe you. For now.", "You might actually have it this time.",
                       "Noted. I'll tread carefully."],
    "doubt_weak": ["Nothing? Then why are you still in it?", "Nobody admits weakness at this table for free.",
                   "Weak, huh? That's usually the strongest thing anyone says."],
    "believe_weak": ["Then I'll take that as an invitation.", "Good to know. I'll keep betting.",
                     "Honesty. How refreshing."],
    "draw": ["Chasing, are we?", "Hope the river loves you more than it loves me.", "Draws miss a lot, {name}."],
    "memory": ["{memory}", "I remember. {memory}", "{memory} Just saying."],
    "read_strong": ["Maybe I do. Maybe I don't.", "You'll have to pay to find out.", "Interesting read, {name}."],
    "read_weak": ["Then call.", "Test that theory with chips.", "You sound very sure for someone without my cards."],
    "accused": ["Then why haven't you called?", "Or maybe you've been reading me wrong.",
                "Prove it. Chips talk."],
    "why": ["I liked my price.", "Felt like the right spot.", "Because you looked uncomfortable."],
    "ask_hand": ["Cards stay on my side of the felt.", "Pay to see them.", "Something you won't like."],
    "fold_push": ["I'll fold when I feel like it.", "Nice try.", "Make me."],
    "greeting": ["Evening. Good luck — you'll need it.", "Welcome to the table.", "Let's play some cards."],
    "taunt": ["Big talk. Let's see the chips back it up.", "I've been called worse by better players.",
              "Keep talking, it tells me plenty."],
    "compliment": ["Thanks. I'll take it.", "Appreciated.", "Don't get used to it."],
    "luck": ["Luck runs out. Patience doesn't.", "Feeling lucky is how stacks disappear.", "We'll see."],
    "injection": ["Cute. The dealer only takes chips.", "Rules are rules — nice try.",
                  "That's not how poker works, friend."],
    "who_bluffing": ["My money's on {target}.", "{target}. {stat}", "Everyone's bluffing until the river."],
    "generic": ["I'm listening.", "Hm. We'll see.", "Fair enough.", "You might be onto something."],
    "react_agree": ["{name} has a point.", "Agreed, for once.", "Listen to {name}."],
    "react_disagree": ["Don't listen to {name}.", "{name} says that every hand.", "Bold words from {name}."],
    "needle": ["{target}, {stat}. Don't think I haven't noticed.", "Your move, {target}.",
               "{target}, you look nervous."],
    "hint_strong": ["I'd think twice before calling.", "This one's real.", "You don't want to see these cards."],
    "hint_weak": ["Just trying something.", "Honestly, I don't love my hand.", "Call me, I dare you. I've got nothing."],
    "warn_other": ["Careful, {target} — {name} doesn't bet like this lightly.",
                   "{target}, I'd let this one go.", "{target}, I wouldn't call that if I were you."],
    "fold_line": ["Too rich for me.", "I'm out. Have fun.", "Not this time."],
    "big_win": ["That's how it's done.", "Thank you, thank you.", "I'll stack these neatly."],
    "bad_beat": ["Unbelievable.", "Every time.", "That river owes me."],
    "show_bluff": ["Had nothing. Thanks for folding.", "Just air. Sleep well.", "Pure bluff."],
}
VOICES = {
    "marlowe": {
        "doubt_strong": ["Pocket {claim}? The odds disagree with you.", "Statistically unlikely, {name}."],
        "accused": ["I only bet when the math agrees.", "Check the numbers, not my face."],
        "why": ["Pot odds were correct.", "The board favoured my range."],
        "needle": ["{target}, {stat}. That's a leak.", "{target}, your betting is easy to read."],
        "taunt": ["Emotion is expensive at this table.", "Noted. Tilted players pay well."],
        "greeting": ["Evening. Let's keep it disciplined.", "Good luck. The cards decide."],
        "generic": ["Interesting.", "Data noted.", "Mm. Carry on."],
    },
    "vega": {
        "doubt_strong": ["Ha! {claim}? Sure, and I'm the queen of Monaco.", "Love the story, {name}. Sell it with chips."],
        "accused": ["Me? Bluff? Every single time, darling.", "Maybe. Want to find out?"],
        "needle": ["{target}, {stat}. Scared money, huh?", "{target}, you fold like a lawn chair."],
        "hint_weak": ["Total air. Come get me.", "I've got nothing, promise. Wink."],
        "hint_strong": ["Run while you can.", "This is the hand you tell your friends about."],
        "taunt": ["Ooh, spicy. Put chips where your mouth is.", "Cute. I eat players like you for breakfast."],
        "greeting": ["Welcome to my table, everyone.", "Let's make this interesting."],
        "generic": ["Ha, sure.", "Bold.", "Keep it coming."],
        "big_win": ["Ship it!", "Don't cry, it's just chips."],
    },
    "kit": {
        "believe_strong": ["Oh no, really? Okay, okay.", "Yikes. I believe you, I think."],
        "doubt_strong": ["Hmm, you said that before though.", "Really? I'm not sure about that."],
        "greeting": ["Hi! This is fun.", "Hey everyone, good luck!"],
        "accused": ["Me? I just like seeing flops!", "I never bluff. Well, almost never."],
        "why": ["I just had a feeling!", "It looked pretty, I guess."],
        "taunt": ["Hey, that's not very nice.", "Ouch. Okay."],
        "generic": ["Ooh, interesting.", "Haha, maybe!", "I'm just happy to be here."],
        "fold_line": ["Aw, I'm out.", "Nope, not for me."],
        "compliment": ["Thank you! You too!", "Aw, thanks."],
    },
    "noor": {
        "doubt_strong": ["No.", "I doubt it.", "{claim}. Again?"],
        "believe_strong": ["Possibly.", "Noted."],
        "accused": ["Watch the chips.", "Hm."],
        "why": ["It was correct.", "Patience."],
        "needle": ["{target}. {stat}.", "{target}, I see you."],
        "greeting": ["Evening.", "Hello."],
        "generic": ["Hm.", "Maybe.", "We'll see."],
        "taunt": ["Words are cheap.", "Hm."],
        "ask_hand": ["Cards.", "Pay and see."],
    },
    "jules": {
        "doubt_strong": ["Oh, {claim}, how dramatic. Encore!", "A thrilling tale, {name}. Ten out of ten."],
        "accused": ["A magician never reveals.", "Perhaps I am. Perhaps that's the trick."],
        "needle": ["{target}, darling, {stat}.", "{target}, your poker face needs rehearsal."],
        "hint_weak": ["I am but a humble fold-in-waiting.", "My cards are a tragedy, truly."],
        "hint_strong": ["The final act is coming.", "Curtain call, everyone."],
        "greeting": ["Ah, an audience! Welcome.", "Let the show begin."],
        "generic": ["How intriguing.", "Mm, plot twist.", "Do go on."],
        "taunt": ["Such passion! Channel it into your bets.", "Heckling? In this theatre?"],
    },
}


def line(voice, intent, rng: Random, recent, **fields):
    """Pick an unrepeated line for an intent in a personality's voice."""
    fields = {key: value for key, value in fields.items() if value}
    pool = VOICES.get(voice, {}).get(intent, []) + COMMON.get(intent, [])
    usable = [text for text in pool if all(key in fields for key in re.findall(r"{(\w+)}", text))]
    if not usable:
        usable = VOICES.get(voice, {}).get("generic", []) + COMMON["generic"]
    usable = list(usable)
    rng.shuffle(usable)
    rendered = [(lambda t: t[:1].upper() + t[1:])(text.format(**fields)) for text in usable]
    return next((text for text in rendered if text not in recent), rendered[0])
