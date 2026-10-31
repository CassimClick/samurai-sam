#!/bin/sh
# Extracts everything from original/samuraisam.swf into .extract/ using JPEXS FFDec.
# Requires Java. FFDec is downloaded into .tools/ on first run.
set -e
cd "$(dirname "$0")/.."

FFDEC_VERSION=26.4.0
FFDEC_DIR=.tools/ffdec
SWF=original/samuraisam.swf
OUT=.extract

if [ ! -f "$FFDEC_DIR/ffdec.jar" ]; then
  mkdir -p "$FFDEC_DIR"
  curl -L -o .tools/ffdec.zip "https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version$FFDEC_VERSION/ffdec_$FFDEC_VERSION.zip"
  unzip -q -o .tools/ffdec.zip -d "$FFDEC_DIR"
  rm .tools/ffdec.zip
fi

ffdec() { java -Djava.awt.headless=true -jar "$FFDEC_DIR/ffdec.jar" "$@" > /dev/null 2>&1; }

rm -rf "$OUT"
mkdir -p "$OUT"
echo "Exporting SWF structure..."; ffdec -swf2xml "$SWF" "$OUT/swf.xml"
echo "Exporting scripts...";       ffdec -export script "$OUT/scripts" "$SWF"
echo "Exporting shapes...";        ffdec -format shape:svg -export shape "$OUT/shapes" "$SWF"
echo "Exporting morph shapes...";  ffdec -format morphshape:svg -export morphshape "$OUT/morph" "$SWF"
echo "Exporting static text...";   ffdec -format text:svg -export text "$OUT/texts" "$SWF"
echo "Exporting images...";        ffdec -export image "$OUT/images" "$SWF"
echo "Exporting sounds...";        ffdec -format sound:mp3_wav -export sound "$OUT/sounds" "$SWF"
echo "Exporting fonts...";         ffdec -format font:woff -export font "$OUT/fonts" "$SWF"
echo "Done. Now run: npm run build:data"
