# Prompt for the deck illustrations

Attach to the first message: `deck/out/deck.pdf` (the whole talk, 16 pages) and `deck/assets/thank-you-feast-gemini.webp`
(the style and cast reference). For illustration 2 also attach a photo of the speaker. Paste the block below, then answer
"next" after each image.

```text
You are the illustrator of a five-minute conference talk. The attached PDF is the whole slide deck (16 pages, 16:9). The attached banquet picture is the style and character reference: every new illustration must look like it came from the same comic album.

THE STORY
The talk is "Veni, Vidi, Compilavi: teaching AI agents to use the Angular compiler". A component library shipped a breaking change and 120 components must be migrated. Two ways to do it:
- the big strong warrior stands for an AI agent armed only with text search: brute force, flattens everything, never asks what it costs;
- the small clever warrior stands for an AI agent that thinks first and drinks the magic potion;
- the magic potion in the druid's cauldron, glowing pink and purple, is the Angular compiler;
- Roman camps and tents are the traps in the code;
- the small tin robot from the banquet picture is "an AI agent" whenever a generic one is needed.

STYLE, FOR EVERY IMAGE
- Franco-Belgian comic album of ancient Gaul: clean black ink outlines, flat vivid colours, expressive faces, slapstick humour.
- Same cast, costumes and proportions as in the banquet reference.
- Accent colours: hot pink #F230BF, red #C41633, purple #A127F2. Anything magical or "compiler" glows pink and purple.
- The background must be ONE flat solid colour, given per image below, edge to edge, with no texture, frame, vignette or shadow on it, so the picture blends into the slide.
- No text, letters, numbers, speech bubbles, captions, signatures or watermarks anywhere.
- Keep the subject inside the middle 90% of the canvas. Highest resolution you can produce.
- One image per reply. After each image wait for me to say "next" or to ask for a change.

THE ILLUSTRATIONS, IN THIS ORDER

1. Cover map (PDF page 1, replaces the map on the right). Portrait 2:3. A hand-drawn parchment map of Gaul around 50 BC seen from above: green land, blue sea, the coastline of today's France with the Brittany peninsula at the upper left, rivers, forests, little Roman eagle standards scattered across the land. On the tip of the Brittany peninsula one tiny fortified village with a wooden palisade, clearly the only spot without a Roman eagle. Background: the sea colour fills the canvas.

2. Speaker card (page 2, right side). Square 1:1. The man from my attached photo drawn in the album's style as a cheerful Gaulish chief: standing on a round shield carried by two small tin robots, an accordion strapped on his back, a yerba mate gourd with a metal straw in one hand, in the other a standard with a geometric shield emblem in a pink to red to purple gradient. Background: solid white #FFFFFF.

3. Occupied monorepo (page 3, bottom right). Wide 2:1. One small Gaulish village behind a palisade, completely surrounded by camps of small tin robots dressed as Roman legionaries, marching in neat squares and looking busy and slightly clueless. Background: solid #F6F4FA.

4. Four traps (page 5, one image per card, four separate replies). Square 1:1 each. Four fortified Roman camps, each with its own gag:
   a) two identical camps side by side and a confused legionary looking from one to the other (same name, different owner);
   b) a camp that is only a painted wooden facade propped up from behind (looks like the real thing, is not);
   c) a brand-new tent with an old patched tent sewn onto its side (the legacy twin);
   d) a camp whose walls are built entirely from rolled scrolls and loose sheets of parchment (text pretending to be structure).
   Background: solid white #FFFFFF.

5. Brute force versus cunning (page 6, two images for the two columns). Portrait 3:4 each.
   a) The big strong warrior charging straight through a wooden palisade with a menhir under his arm, splinters and scrolls flying, a trail of gold coins falling out of his pouch behind him.
   b) The small clever warrior sitting calmly on a tree stump, sipping the glowing pink and purple potion from a small flask, a tiny scroll with four short lines in his other hand, winking.
   Background: solid dark plum #24102F.

6. The reader that never skims (page 7, top right). Square 1:1. The old druid with a long white beard bent over the cauldron of glowing pink and purple potion, reading an absurdly long scroll through a magnifying glass, with total concentration; the scroll runs down, around the cauldron and out of the picture. Background: solid #F6F4FA.

7. Four stages of brewing (page 8, a strip above or below the four boxes). Very wide 4:1. Four stations left to right on one long table: the druid chopping herbs into neat labelled piles; sorting them into jars on a shelf, each jar with a different symbol; a taster sipping a spoonful and pulling a disgusted face while a referee raises a red flag; bottling the potion into small flasks, this last station drawn in pale grey as if faded. Background: solid dark plum #170621.

8. The spec (page 11, small accent). Square 1:1. One tiny rolled-out parchment with exactly four short wavy lines of unreadable scribble on it, sealed with a pink wax seal, lying next to a huge towering pile of thick scrolls that it replaces. Background: solid white #FFFFFF.

9. The race (page 12, top right, replaces the magnifier). Wide 16:9. A chariot race in a small wooden arena: on the left the big strong warrior pulls a heavy cart loaded with menhirs himself, sweating and panting; on the right the small clever warrior rides a light chariot drawn by a boar that has clearly had a sip of the potion, leaving a pink and purple trail. Both are about to cross the same finish line. Background: solid #F6F4FA.

10. Four referees (page 13, a strip). Very wide 4:1. Four stern Roman officials sitting in a row behind a long judging desk, each holding up a blank round paddle, each with a different attribute: a magnifying glass, a balance scale, a building trowel, a wax-sealed contract. Background: solid white #FFFFFF.

11. Closing (page 15, right side, replaces the village and tents). Square 1:1. The Gaulish village at night seen from outside the palisade, warm lights in the huts, the standard with the pink to red to purple shield emblem planted at the gate, and three abandoned Roman tents in the foreground. Background: solid dark plum #170621.

Start with illustration 1.
```

## Notes

- Sizes in the deck: cover map 761×1080, speaker card about 400×400, traps 120×120 inside the cards (ask for simple, bold shapes), strips up to 1664 wide.
- If an image comes back with a textured or gradient background, reply: "Same image, but make the background one flat colour #XXXXXX, edge to edge."
- If lettering sneaks in, reply: "Remove every letter and number from the image."
- Save the results in `deck/assets/` and they can be uploaded to the deck one by one.
