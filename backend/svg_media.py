"""Convert bounded, self-contained vector output into a reusable PNG."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import resvg_py

SVG_NS = 'http://www.w3.org/2000/svg'
MAX_BYTES = 4 * 1024 * 1024
# Vector drawing only: no scripts, raster image loaders, foreign HTML or animation.
TAGS = set('svg g defs title desc metadata path rect circle ellipse line polyline polygon text tspan textPath '
           'use symbol clipPath mask linearGradient radialGradient stop pattern filter '
           'feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting '
           'feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR '
           'feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting '
           'feSpotLight feTile feTurbulence style'.split())
ALLOWED_TAGS = {'{' + SVG_NS + '}' + tag for tag in TAGS}


def rasterize(source: Path, target: Path):
    if source.stat().st_size > MAX_BYTES:
        raise ValueError('El SVG supera el límite de 4 MB.')
    try:
        text = source.read_text(encoding='utf-8-sig')
        # Block XML entities and declarations before parsing, including external DTDs.
        if re.search(r'<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)', text, re.I):
            raise ValueError()
        root = ET.fromstring(text)
        if root.tag != '{' + SVG_NS + '}svg':
            raise ValueError()
        elements = list(root.iter())
        if len(elements) > 50000:
            raise ValueError()
        for node in elements:
            if node.tag not in ALLOWED_TAGS:
                raise ValueError()
            for name, value in node.attrib.items():
                local = name.rsplit('}', 1)[-1].lower()
                if local.startswith('on') or local == 'base':
                    raise ValueError()
                if local == 'href' and not re.fullmatch(r'#[A-Za-z_][\w.:-]*', value):
                    raise ValueError()
            values = '\n'.join(node.attrib.values()) + '\n' + (node.text or '')
            # Only local paint/filter references; CSS imports, escapes and external resources are refused.
            if '@' in values or '\\' in values or re.search(r'(?:https?|file|data|javascript):|expression\s*\(', values, re.I):
                raise ValueError()
            for match in re.finditer(r'url\s*\((.*?)\)', values, re.I | re.S):
                if not re.fullmatch(r'[\s\'"]*#[A-Za-z_][\w.:-]*[\s\'"]*', match.group(1)):
                    raise ValueError()
        # Preserve aspect ratio from the viewBox, while bounding the allocated bitmap.
        box = re.split(r'[\s,]+', root.get('viewBox', '').strip())
        if len(box) == 4:
            width, height = float(box[2]), float(box[3])
        else:
            width = float(re.fullmatch(r'([\d.]+)(?:px)?', root.get('width', '1024')).group(1))
            height = float(re.fullmatch(r'([\d.]+)(?:px)?', root.get('height', '1024')).group(1))
        if not 0 < width <= 100000 or not 0 < height <= 100000:
            raise ValueError()
        scale = min(2048 / width, 2048 / height)
        png = resvg_py.svg_to_bytes(svg_string=ET.tostring(root, encoding='unicode'),
                                    width=max(1, round(width * scale)), height=max(1, round(height * scale)))
    except (ET.ParseError, UnicodeError, AttributeError, TypeError, ValueError, OverflowError):
        raise ValueError('SVG no compatible. Se requieren vectores sin scripts, archivos externos ni entidades XML.') from None
    temporary = target.with_suffix('.png.part')
    temporary.write_bytes(png)
    temporary.replace(target)
    return target
