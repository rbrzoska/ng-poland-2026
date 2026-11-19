"""Step 2 of the PowerPoint export: python3 deck/pptx-build.py (after node deck/pptx-layers.mjs).

Stacks the picture layers from deck/out/pptx into deck/out/veni-vidi-compilavi-five-min.pptx: one slide per deck slide,
speaker notes carried over and a fade between slides. Everything is on the slide at once, except a layer under
data-step="n" in the slide source, which fades in on the n-th click; a slide named "<name>-2" keeps what the
slide before it already showed. The first version was checked by opening it in Keynote.
Needs python-pptx (pip install python-pptx).
"""
import json
import os
import re
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Emu, Pt

DECK = Path(__file__).parent
# PPTX_TEXT=1 builds from deck/out/pptx-text (node deck/pptx-layers.mjs with PPTX_TEXT=1): the text is real, editable text.
TEXT = os.environ.get("PPTX_TEXT") == "1"
LAYERS = DECK / ("out/pptx-text" if TEXT else "out/pptx")
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
# PPTX_OUT=<file> writes somewhere else, for when PowerPoint has the file open and Windows will not let it be replaced
TARGET = Path(os.environ.get("PPTX_OUT") or DECK / "out/veni-vidi-compilavi-five-min.pptx").resolve()
EMU_PER_PIXEL = 6350
TITLE_ONLY_LAYOUT = 5
CLICK_FADE_MS = 250
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

FADE, WIPE, RISE, ZOOM = "fade", "wipe", "rise", "zoom"
EFFECT_OF = {"kicker": FADE, "title": WIPE, "text": FADE, "item": RISE, "card": RISE, "frame": FADE, "row": RISE, "image": ZOOM}
PRESET_OF = {FADE: (10, 0), WIPE: (22, 8), RISE: (42, 0), ZOOM: (53, 16)}


class Ids:
    def __init__(self):
        self.last = 0

    def next(self):
        self.last += 1
        return self.last


def target(shape_id):
    return f'<p:tgtEl><p:spTgt spid="{shape_id}"/></p:tgtEl>'


def show(ids, shape_id):
    return (f'<p:set><p:cBhvr><p:cTn id="{ids.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            f'{target(shape_id)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
            f'<p:to><p:strVal val="visible"/></p:to></p:set>')


def reveal(ids, shape_id, effect_filter, duration):
    return (f'<p:animEffect transition="in" filter="{effect_filter}"><p:cBhvr><p:cTn id="{ids.next()}" dur="{duration}"/>'
            f'{target(shape_id)}</p:cBhvr></p:animEffect>')


def move(ids, shape_id, attribute, start, end, duration):
    return (f'<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="{ids.next()}" dur="{duration}" decel="100000" fill="hold"/>'
            f'{target(shape_id)}<p:attrNameLst><p:attrName>{attribute}</p:attrName></p:attrNameLst></p:cBhvr>'
            f'<p:tavLst><p:tav tm="0"><p:val><p:strVal val="{start}"/></p:val></p:tav>'
            f'<p:tav tm="100000"><p:val><p:strVal val="{end}"/></p:val></p:tav></p:tavLst></p:anim>')


def behaviours(ids, shape_id, effect, duration):
    if effect == WIPE:
        return show(ids, shape_id) + reveal(ids, shape_id, "wipe(left)", duration)
    if effect == RISE:
        return (show(ids, shape_id) + reveal(ids, shape_id, "fade", duration)
                + move(ids, shape_id, "ppt_x", "#ppt_x", "#ppt_x", duration)
                + move(ids, shape_id, "ppt_y", "#ppt_y+.04", "#ppt_y", duration))
    if effect == ZOOM:
        return (show(ids, shape_id)
                + move(ids, shape_id, "ppt_w", "#ppt_w*0.70", "#ppt_w", duration)
                + move(ids, shape_id, "ppt_h", "#ppt_h*0.70", "#ppt_h", duration)
                + reveal(ids, shape_id, "fade", duration))
    return show(ids, shape_id) + reveal(ids, shape_id, "fade", duration)


def timing(groups):
    """One build per click: every group waits for a click, and its layers fade in together.

    Layers that are not in a group have no animation at all: they are simply on the slide when it appears.
    """
    ids = Ids()
    root, sequence = ids.next(), ids.next()
    body = ""
    for steps in groups:
        if not steps:
            continue
        group, stage = ids.next(), ids.next()
        effects = ""
        for position, (shape_id, effect, duration) in enumerate(steps):
            preset, subtype = PRESET_OF[effect]
            node = "clickEffect" if position == 0 else "withEffect"
            effects += (f'<p:par><p:cTn id="{ids.next()}" presetID="{preset}" presetClass="entr" presetSubtype="{subtype}" fill="hold" nodeType="{node}">'
                        f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{behaviours(ids, shape_id, effect, duration)}</p:childTnLst></p:cTn></p:par>')
        body += (f'<p:par><p:cTn id="{group}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
                 f'<p:par><p:cTn id="{stage}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{effects}</p:childTnLst></p:cTn></p:par>'
                 f'</p:childTnLst></p:cTn></p:par>')
    return (f'<p:timing xmlns:p="{P}"><p:tnLst><p:par><p:cTn id="{root}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="{sequence}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
            f'{body}'
            f'</p:childTnLst></p:cTn>'
            f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            f'</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')



def is_empty(picture_file):
    """A layer whose picture has nothing painted (pure text) needs no picture at all."""
    with Image.open(picture_file) as picture:
        return picture.mode == "RGBA" and picture.getchannel("A").getextrema()[1] == 0


def add_line(slide, line):
    """One line of text as its own text box: no wrapping, no margins, so it sits where the browser put it."""
    width = line["width"] * 1.15 + 24
    box = slide.shapes.add_textbox(*(Emu(int(value * EMU_PER_PIXEL)) for value in (line["x"], line["y"], width, line["height"])))
    frame = box.text_frame
    frame.word_wrap = False
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.vertical_anchor = MSO_ANCHOR.TOP
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
    paragraph = frame.paragraphs[0]
    for part in line["runs"]:
        run = paragraph.add_run()
        run.text = part["text"]
        font = run.font
        font.name = part["family"]
        font.size = Pt(part["size"] / 2)  # the slide is 1920 px = 960 pt wide
        font.bold = part["bold"]
        font.italic = part["italic"]
        font.color.rgb = RGBColor.from_string(part["colour"])
        properties = run._r.get_or_add_rPr()
        if part["spacing"]:
            properties.set("spc", str(round(part["spacing"] * 50)))
        if part.get("gradient"):
            start, end = part["gradient"]
            for fill in properties.findall(f"{{{A}}}solidFill"):
                properties.remove(fill)
            properties.insert(0, etree.fromstring(
                f'<a:gradFill xmlns:a="{A}" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="{start}"/></a:gs>'
                f'<a:gs pos="100000"><a:srgbClr val="{end}"/></a:gs></a:gsLst><a:lin ang="1800000" scaled="0"/></a:gradFill>'))
    return box


def describe(picture, text):
    picture._element.nvPicPr.cNvPr.set("descr", text)


def register_notes_master(presentation):
    """python-pptx adds the notes master part but not its entry in presentation.xml; Keynote rejects the file without it."""
    relationship_id = presentation.part.relate_to(presentation.part.notes_master_part, RT.NOTES_MASTER)
    entry = etree.fromstring(f'<p:notesMasterIdLst xmlns:p="{P}" xmlns:r="{R}"><p:notesMasterId r:id="{relationship_id}"/></p:notesMasterIdLst>')
    presentation.element.find(f"{{{P}}}sldMasterIdLst").addnext(entry)


manifest = json.loads((LAYERS / "manifest.json").read_text(encoding="utf8"))
# PPTX_SLIDES=talk keeps only the slides before the appendix (MAIN); PPTX_NOTES=0 leaves the speaker notes out (public file).
TALK_ONLY = os.environ.get("PPTX_SLIDES") == "talk"
WITH_NOTES = os.environ.get("PPTX_NOTES", "1") != "0"
entries = manifest["slides"]
if TALK_ONLY:
    deck = json.loads((DECK / "five-min/project/deck.json").read_text(encoding="utf8"))
    talk = deck["order"][:deck["order"].index(deck["sections"]["backup"]["start"])]
    entries = [entry for entry in entries if entry["id"] in talk]
presentation = Presentation()
presentation.slide_width = Emu(manifest["slide"]["width"] * EMU_PER_PIXEL)
presentation.slide_height = Emu(manifest["slide"]["height"] * EMU_PER_PIXEL)
presentation.core_properties.title = manifest["title"]
presentation.core_properties.author = "Rafał Brzoska"

CONTINUES = re.compile(r".+-([2-9])$")
signature = lambda unit: (unit["kind"], unit["text"], unit["box"]["x"], unit["box"]["y"], unit["box"]["width"], unit["box"]["height"])
previous, clicks = None, 0

for entry in entries:
    slide = presentation.slides.add_slide(presentation.slide_layouts[TITLE_ONLY_LAYOUT])
    slide.shapes.title.text = entry["title"]
    slide.shapes.title.top = Emu(-presentation.slide_height // 4)
    slide.shapes.title.left, slide.shapes.title.width, slide.shapes.title.height = Emu(0), presentation.slide_width, Emu(600000)
    describe(slide.shapes.add_picture(str(LAYERS / entry["base"]), 0, 0, presentation.slide_width, presentation.slide_height), "Slide background")

    shape_ids = {}  # layer -> the shapes that make it up: its picture and, in text mode, its lines of text
    for unit in entry["units"]:
        box = unit["box"]
        shapes = []
        if not (unit.get("lines") and is_empty(LAYERS / unit["file"])):
            picture = slide.shapes.add_picture(str(LAYERS / unit["file"]), *(Emu(box[side] * EMU_PER_PIXEL) for side in ("x", "y", "width", "height")))
            describe(picture, "" if unit.get("lines") else unit["text"])
            shapes.append(picture.shape_id)
        for line in unit.get("lines", []):
            shapes.append(add_line(slide, line).shape_id)
        shape_ids[unit["file"]] = shapes
    if WITH_NOTES and entry["notes"]:
        slide.notes_slide.notes_text_frame.text = entry["notes"]

    # A slide named "<name>-2", "<name>-3" continues the one before it: what was already there stays put, only the new layers move.
    continues = previous is not None and CONTINUES.match(entry["id"]) and previous["id"].rsplit("-", 1)[0] == entry["id"].rsplit("-", 1)[0]
    already_there = {signature(unit) for unit in previous["units"]} if continues else set()
    moving = [unit for unit in entry["units"] if signature(unit) not in already_there]
    last_step = max((unit.get("step", 0) for unit in moving), default=0)
    # Layers without a step are on the slide from the start, with no animation; each step is one click.
    groups = [[(shape, FADE, CLICK_FADE_MS) for unit in moving if unit.get("step", 0) == step for shape in shape_ids[unit["file"]]] for step in range(1, last_step + 1)]
    if not continues:
        slide._element.append(etree.fromstring(f'<p:transition xmlns:p="{P}" spd="fast"><p:fade/></p:transition>'))
    if any(groups):
        slide._element.append(etree.fromstring(timing(groups)))
    clicks += sum(1 for group in groups if group)
    previous = entry

register_notes_master(presentation)
presentation.save(str(TARGET))
print(f"{TARGET.name}: {len(entries)} slides, {clicks} builds on a click, {'with' if WITH_NOTES else 'no'} notes, {TARGET.stat().st_size / 1e6:.1f} MB")
