# Docket home page

The marketing page for the platform: what a Nigerian firm sees before it
registers, and what a client sees before their firm sends them a link. It is a
design artboard, not shipping code. `app/page.tsx` is the page that actually
serves; this is where its argument and its typography get worked out first.

    Main.dc.html   the artboard, one file, inline styles
    canvas.json    frame size and launch view for the design canvas
    verify.mjs     renders it and fails on the rules below

`.dc.html` is a Claude Design artboard. The `./support.js` line in the head and
the `<x-dc>` / `<helmet>` wrapper are the canvas runtime and must stay verbatim;
`verify.mjs` strips them to render the file as an ordinary page.

## The rules

**Colour.** Green is the ink and the ground. Gold is only ever a fill, a rule,
or type sitting on green, and never text on paper.

| role | value | note |
| --- | --- | --- |
| paper | `#f3f2f2` | warm, never white |
| ink | `#201e1d` | |
| hunter green | `#2c4a34` | 8.8:1 on paper |
| deep hunter | `#203024` | the walkthrough band |
| link green | `#3f694a` | |
| victory gold | `#ffb81c` | |
| pale gold | `#ffcb71` | |
| muted text | `#5b5959`, `#3f3d3c` | |
| hairline | `#b4b2b2` | decorative rules only |
| control edge | `#7d7a7a` | form borders, 3.8:1 on paper |
| form surface | `#eae9e9` | |

**Type.** Eight sizes, nothing between them: 11, 13, 15, 21, 26, 44, 56, 88.
Archivo throughout. Fraunces only inside a firm's own branded frame.

**Rules and marks.** 1px `#b4b2b2` hairlines, 4px `#2c4a34` chapter rules, 3px
gold marks.

**Display headings are hand-set.** At 44px and above the browser's greedy wrap
breaks on prepositions and orphans single words, so the breaks are explicit
`<br>`. Change the words and you have to re-set the breaks; `verify.mjs` will
tell you when a heading has started ending on one word.

**Nigerian brand risk.** Dark green with gold is close to the passport and the
flag. Green chroma is capped well below flag green, the ground is warm rather
than white, there are no symmetric green-white-green thirds, no green-and-gold
crest or card object, the layout is asymmetric, and the footer disclaims
affiliation with any court, the Nigerian Bar Association or any government
agency. Keep all six.

## What the page may claim

Every concrete claim has to be true of the code on the branch, and the page
distinguishes what is live from what is in build. As at the last pass: booking,
Paystack checkout settling to the firm's own subaccount, video consultations
with a waiting room, court-date reminders, and the service inbox with
acknowledgement are live. The matters console, the court-update form, the
client timeline, documents, messaging and invoicing are in build. Nothing
installs, nothing validates a suit number, and no plan meters lawyers.

Nigerian detail is checked the same way. Suit-number prefixes are the judicial
division's own (Ikeja is `ID/`, Lagos is `LD/`), courts are named with their
Judicial Division, a part-heard matter is continued rather than heard, a search
report is received rather than filed, references take the shape
`<prefix>-M-<year>-<six digits>` that `next_reference()` issues, and VAT is the
single statutory rate rather than a rate each firm sets.

## Working on it

Edit `Main.dc.html`, then:

    node design/home/verify.mjs        # see the header for the font setup

Fetch the real Archivo and Fraunces first. The fallbacks are metrically
unrelated, and a fallback run reported this page as fitting when the published
one clipped an exhibit by 19px.

To put it back on the canvas, seed a fresh payload with the `design` skill's
`seed-canvas.mjs`, passing `Main.dc.html` and `canvas.json`, then publish the
seeded file. Keep `canvas.json`'s `h` a little above the height `verify.mjs`
prints; surplus paints the artboard background, clipping is the only failure.
