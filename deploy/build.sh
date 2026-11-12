#!/bin/sh
# Lo que corre Vercel (proyecto dchicken-express): descarga la rama web, genera la carta y publica site/.
set -e
rm -rf src public
git clone --depth 1 -b web https://github.com/jsebastiantorres007-alt/dchicken-express-android src
cd src
python3 build.py
git log -1 --format='publicando %h %s'
cp -r site ../public
echo listo
