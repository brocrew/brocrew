#!/usr/bin/env python3
"""Make BroBot's icon files from the idle avatar: the white robot on a navy rounded tile.

Usage: python3 scripts/make-brobot-icon.py icons/idle.png apps/desktop/build
Writes into <out-dir>:
  robot.png          the robot cut out of its white background, with the floor under it removed
  icon-1024.png      the macOS icon: a navy rounded tile (Apple's 824 px grid) on a 1024 px canvas
  icon.icns          macOS, from an iconset of 16 to 1024 px (iconutil)
  icon-windows.png   256 px, the tile filling the square, for Windows
  icon.ico           Windows, 16 to 256 px
  logo-256.png       the tile at 256 px, for the README
Needs ImageMagick (`magick`) and, for the .icns, macOS's `iconutil`.
The cut's numbers (the 3% tolerance, the 50 px floor band) were tuned on the 420 x 420 avatar: after
a new source, look at robot.png before using the rest.
"""
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path

source, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


def magick(*args, capture=False):
    return subprocess.run(['magick', *map(str, args)], check=True, capture_output=capture).stdout


# 1. Cut the robot out: flood the white background from the four corners (3% tolerance; more eats
#    into the robot's own white), then trim.
right, bottom = (int(v) - 1 for v in magick(source, '-format', '%w %h', 'info:', capture=True).split())
cut = out / 'robot-cut.png'
magick(source, '-alpha', 'set', '-fuzz', '3%', '-fill', 'none',
       '-draw', 'color 0,0 floodfill', '-draw', f'color {right},0 floodfill',
       '-draw', f'color 0,{bottom} floodfill', '-draw', f'color {right},{bottom} floodfill',
       '-trim', '+repage', cut)
width, height = (int(v) for v in magick(cut, '-format', '%w %h', 'info:', capture=True).split())
pixels = bytearray(magick(cut, '-depth', '8', 'rgba:-', capture=True))


def at(x, y):
    i = (y * width + x) * 4
    return pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]


# 2. Remove the light floor under the robot: in the bottom band, each column keeps what lies above
#    its lowest dark crease (the shadow line under the hands and the body), plus one pixel of
#    antialiasing, and loses the rest. A column with no crease there has no robot in the band.
band = height - 50
for x in range(width):
    lowest = None
    for y in range(band, height):
        r, g, b, a = at(x, y)
        if a > 200 and 0.299 * r + 0.587 * g + 0.114 * b < 190:
            lowest = y
    start = lowest + 2 if lowest is not None else band + 8
    for y in range(start, height):
        pixels[(y * width + x) * 4 + 3] = 0

# 3. Keep only the largest connected shape: drops stray specks the flood left behind.
seen = bytearray(width * height)
shapes = []
for start in range(width * height):
    if seen[start] or pixels[start * 4 + 3] == 0:
        continue
    shape, queue = [], deque([start])
    seen[start] = 1
    while queue:
        p = queue.popleft()
        shape.append(p)
        x, y = p % width, p // width
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height:
                q = ny * width + nx
                if not seen[q] and pixels[q * 4 + 3] > 0:
                    seen[q] = 1
                    queue.append(q)
    shapes.append(shape)
shapes.sort(key=len, reverse=True)
for shape in shapes[1:]:
    for p in shape:
        pixels[p * 4 + 3] = 0
print(f'cutout {width}x{height}; dropped {len(shapes) - 1} specks ({sum(map(len, shapes[1:]))} px)')

robot = out / 'robot.png'
# The flood leaves a hard edge with a 1 px rim of the old white background: erode the edge by a
# pixel, then feather it so it scales up without jaggies.
subprocess.run(['magick', '-size', f'{width}x{height}', '-depth', '8', 'rgba:-',
                '-channel', 'A', '-morphology', 'Erode', 'Diamond:1', '-blur', '0x0.7', '-level', '35%,100%',
                '+channel', '-trim', '+repage', str(robot)],
               input=bytes(pixels), check=True)
cut.unlink()

# 4. The tile: a navy gradient, Apple's rounded square (824 px, radius 185) on a 1024 px canvas.
tile = out / 'tile.png'
magick('-size', '824x824', 'gradient:#25466e-#0e1a2b',
       '(', '-size', '824x824', 'xc:none', '-fill', 'white', '-draw', 'roundrectangle 0,0 823,823 185,185', ')',
       '-compose', 'CopyOpacity', '-composite', tile)
icon = out / 'icon-1024.png'
magick('-size', '1024x1024', 'xc:none', tile, '-geometry', '+100+100', '-composite',
       '(', robot, '-filter', 'Lanczos', '-resize', 'x600', ')', '-gravity', 'center', '-geometry', '+0+18',
       '-composite', icon)
tile.unlink()

# 5. macOS: an iconset, then iconutil.
iconset = out / 'icon.iconset'
iconset.mkdir(exist_ok=True)
for size in (16, 32, 128, 256, 512):
    magick(icon, '-filter', 'Lanczos', '-resize', f'{size}x{size}', iconset / f'icon_{size}x{size}.png')
    magick(icon, '-filter', 'Lanczos', '-resize', f'{size * 2}x{size * 2}', iconset / f'icon_{size}x{size}@2x.png')
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(out / 'icon.icns')], check=True)
shutil.rmtree(iconset)

# 6. Windows: the tile fills the square (no macOS margin), 16 to 256 px.
windows = out / 'icon-windows.png'
magick(icon, '-crop', '840x840+92+92', '+repage', '-filter', 'Lanczos', '-resize', '256x256', windows)
magick(windows, '-define', 'icon:auto-resize=256,128,64,48,32,16', out / 'icon.ico')

# 7. README: the tile at 256 px.
magick(icon, '-filter', 'Lanczos', '-resize', '256x256', out / 'logo-256.png')

for path in sorted(out.iterdir()):
    print(f'{path.stat().st_size:>9}  {path.name}')
